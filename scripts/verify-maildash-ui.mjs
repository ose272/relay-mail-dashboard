import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'file:///C:/Users/kING/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { server, qaDb } from './qa-server.mjs';
await mkdir('.qa',{recursive:true});
await new Promise(resolve=>server.listen(4175,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const nav=async(name)=>{if(await page.getByRole('button',{name:'Open navigation menu',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true}).click();};
try{
 await page.goto('http://127.0.0.1:4175');await page.getByRole('heading',{name:'No active campaign'}).waitFor();
 assert.ok(!(await page.locator('body').innerText()).includes('128'));
 await page.screenshot({path:'.qa/desktop-sending.png',fullPage:true});
 await nav('Leads');const importForm=page.locator('form').first();await importForm.locator('input[type=text]').first().fill('Quoted import QA');await importForm.locator('textarea').fill('name,email,store\n"QA, Person",qa@invalid.test,"QA, Store"');await importForm.getByRole('button',{name:/Import.*batch/}).click();await page.getByText('qa@invalid.test',{exact:true}).first().waitFor();assert.equal(qaDb.sqlite.prepare('SELECT name FROM leads').get().name,'QA, Person');
 await nav('Scouting plans');await page.getByRole('button',{name:'+ Create scouting plans'}).click();await page.getByLabel('Plan name',{exact:true}).fill('Body only QA');await page.getByLabel('Message body',{exact:true}).fill('Hi {{name}}, a local QA message.');await page.getByRole('button',{name:'Save plans',exact:true}).click();await page.getByRole('heading',{name:'Body only QA',exact:true}).waitFor();assert.equal(qaDb.sqlite.prepare('SELECT subject FROM templates').get().subject,'');
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByRole('button',{name:'Activate',exact:true}).waitFor();assert.ok(qaDb.sqlite.prepare('SELECT archived_at FROM templates').get().archived_at);
 await nav('Settings');await page.getByLabel('Workspace name',{exact:true}).fill('QA workspace');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Changes saved.',{exact:true}).waitFor();assert.equal(qaDb.sqlite.prepare("SELECT value FROM app_settings WHERE key='workspaceName'").get().value,'QA workspace');
 // Exercise the table with the expected production account count, all local fixtures.
 const insert=qaDb.sqlite.prepare("INSERT INTO accounts(id,email,created_at,connection) VALUES(?,?,?,'Connected')");for(let i=0;i<74;i++)insert.run('qa'+i,`local${i}@invalid.test`,'2026-01-01');
 await nav('Sending');await page.reload();await page.getByRole('heading',{name:'No active campaign'}).waitFor();await nav('Accounts');await page.getByText('local73@invalid.test',{exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),74);await page.screenshot({path:'.qa/desktop-accounts.png',fullPage:true});
 // Check all pages at desktop, tablet and phone, including layout overflow.
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});for(const name of ['Dashboard','Inbox','Sending','Leads','Scouting plans','Accounts','Notifications','Settings']){await nav(name);await page.waitForTimeout(100);const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(size.scroll<=size.width+1,`${name} overflows at ${width}: ${JSON.stringify(size)}`);}await nav('Sending');await page.screenshot({path:`.qa/layout-${width}.png`,fullPage:true});}
 await page.setViewportSize({width:390,height:844});await nav('Settings');await page.getByRole('button',{name:'Dark mode',exact:true}).click();await page.screenshot({path:'.qa/mobile-dark-settings.png',fullPage:true});
 // No real mail/provider connections are possible from this harness.
 assert.deepEqual(errors,[]);console.log('PASS: real local API imports, body-only plans, plan pause, saved settings, 74-account table, 7 screens at 1440/768/390px, dark mode, zero browser errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));qaDb.sqlite.close();}
