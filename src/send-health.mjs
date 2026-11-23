export function sendFailureHealth(error) {
 const code=Number(error.responseCode || 0),text=String(error.response || error.message || ''),command=String(error.command || '').toUpperCase();
 if(code===535 || code===534 || error.code==='EAUTH')return {status:'Problem',code:'SMTP_AUTH',message:'Gmail rejected sender authentication. This account is paused; reconnect it before resuming.',pause:true};
 if(command!=='RCPT TO' && /\b(?:account|sender)\b.{0,100}\b(?:disabled|suspended|restricted|blocked)\b/i.test(text))return {status:'Restricted',code:'SMTP_RESTRICTED',message:'Gmail reported a sender account restriction. This account is paused; check it with the provider before resuming.',pause:true};
 if(/quota|rate.?limit|too many|sending limit/i.test(text))return {status:'Warning',code:'SMTP_LIMIT',message:'Gmail temporarily limited sending. This sender is held until its retry time; other eligible accounts can continue.',pause:false};
 return null;
}

export function smtpRetryMinutes(error,attempt){const text=String(error.response || error.message || '');if(/daily.{0,60}(?:limit|quota)|(?:limit|quota).{0,60}daily/i.test(text))return 1440;return [5,15,60][Math.min(2,Math.max(0,attempt-1))];}
