// Application-side headroom below the D1 Free allowance. This tracks this API's
// traffic, not external Wrangler/dashboard queries or unrelated applications.
export const READ_BUDGET = 4_000_000;
export const WRITE_BUDGET = 80_000;

export function usageBudgets(env = {}) {
  return env.APP_USAGE_TIER === 'paid'
    ? {reads: 500_000_000, writes: 1_500_000}
    : {reads: READ_BUDGET, writes: WRITE_BUDGET};
}

export function meteredD1(raw, initial = {rows_read: 0, rows_written: 0}, budgets = usageBudgets()) {
  let reads = 0, writes = 0;
  const rawStatement = Symbol('rawStatement');
  const remainingBudget = () => ({
    reads: budgets.reads - Number(initial.rows_read || 0) - reads,
    writes: budgets.writes - Number(initial.rows_written || 0) - writes
  });
  const record = result => {
    reads += Number(result.meta?.rows_read || 0);
    writes += Number(result.meta?.rows_written || 0);
    return result;
  };
  const wrap = statement => ({
    [rawStatement]: statement,
    bind: (...args) => wrap(statement.bind(...args)),
    all: async () => record(await statement.all()),
    run: async () => record(await statement.run()),
    first: async column => {
      const result = record(await statement.all());
      const row = result.results?.[0];
      return column ? row?.[column] ?? null : row ?? null;
    }
  });
  return {
    db: {
      remainingBudget,
      prepare: sql => wrap(raw.prepare(sql)),
      batch: async statements => {
        const results = await raw.batch(statements.map(statement => statement[rawStatement]));
        results.forEach(record);
        return results;
      }
    },
    flush: async day => {
      // Requests are gated before work begins. Always allow an in-flight send to
      // record its confirmation; do not interrupt it at an accounting threshold.
      // Include conservative overhead for the gate and accounting statement.
      await raw.prepare(`INSERT INTO app_usage_days(day,rows_read,rows_written) VALUES(?,?,?)
        ON CONFLICT(day) DO UPDATE SET rows_read=rows_read+excluded.rows_read,
        rows_written=rows_written+excluded.rows_written`).bind(day, reads + 4, writes + 3).run();
    }
  };
}

// Paid D1 has monthly inclusions; keep the dashboard readable during an application send hold.
export function allowBudgetRead(env,method,path){return env.APP_USAGE_TIER==='paid' && method==='GET' && ['/api/analytics','/api/state','/api/sending/status','/api/notifications','/api/thread'].includes(path);}

// Inbox operations have a small reserve; campaign sending retains its original guard.
export function requestUsageBudgets(env,method,path){const base=usageBudgets(env);return env.APP_USAGE_TIER==='paid' && method==='POST' && ['/api/mail/sync','/api/mail/conversation','/api/thread/update','/api/read'].includes(path)?{...base,writes:base.writes+50000}:base;}
export async function readUsageDay(db,day){for(let attempt=0;;attempt++){try{return await db.prepare('SELECT rows_read,rows_written FROM app_usage_days WHERE day=?').bind(day).first() || {rows_read:0,rows_written:0};}catch(error){if(attempt>=2 || !/overload|busy|timeout|timed out|temporar|internal|connection/i.test(String(error?.message || '')))throw error;await new Promise(resolve=>setTimeout(resolve,attempt?300:100));}}}
