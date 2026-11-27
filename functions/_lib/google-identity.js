const encoder=new TextEncoder();
export const googleScopes=['openid','email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send'];
export const base64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export const randomToken=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export const pkceChallenge=async verifier=>base64url(await crypto.subtle.digest('SHA-256',encoder.encode(verifier)));
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
const keyCache=new WeakMap();
export async function providerJson(fetcher,url,init={}){
 const response=await fetcher(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok){const error=new Error('Google request failed.');error.status=response.status;const body=await response.json().catch(()=>null);if(['invalid_grant','invalid_client','access_denied'].includes(body?.error))error.providerCode=body.error;throw error;}
 return response.json();
}
async function signingKeys(fetcher,force=false){
 const cached=keyCache.get(fetcher);if(!force&&cached&&cached.expires>Date.now())return cached.keys;
 const data=await providerJson(fetcher,'https://www.googleapis.com/oauth2/v3/certs');
 if(!Array.isArray(data.keys))throw Error('Invalid Google signing keys.');
 keyCache.set(fetcher,{keys:data.keys,expires:Date.now()+3600000});return data.keys;
}
export async function verifyGoogleIdentity(token,{clientId,nonceHash,fetcher=fetch,now=Date.now()}){
 if(typeof token!=='string'||token.length>16000)throw Error('Invalid Google identity.');
 const parts=token.split('.');if(parts.length!==3)throw Error('Invalid Google identity.');
 const header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(parts[0])));
 const identity=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(parts[1])));
 if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200)throw Error('Unsupported Google identity.');
 let keys=await signingKeys(fetcher),jwk=keys.find(k=>k.kid===header.kid);
 if(!jwk){keys=await signingKeys(fetcher,true);jwk=keys.find(k=>k.kid===header.kid);}
 if(!jwk||jwk.kty!=='RSA'||jwk.use&&jwk.use!=='sig'||jwk.alg&&jwk.alg!=='RS256')throw Error('Unrecognized Google signing key.');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),encoder.encode(parts[0]+'.'+parts[1])))throw Error('Invalid Google signature.');
 const audiences=Array.isArray(identity.aud)?identity.aud:[identity.aud];
 if(!['accounts.google.com','https://accounts.google.com'].includes(identity.iss)||!audiences.includes(clientId)||audiences.length>1&&identity.azp!==clientId||identity.azp&&identity.azp!==clientId)throw Error('Google identity audience mismatch.');
 const seconds=now/1000;
 if(!Number.isFinite(identity.exp)||identity.exp<=seconds||!Number.isFinite(identity.iat)||identity.iat>seconds+120||identity.iat<seconds-86400)throw Error('Expired Google identity.');
 if(typeof identity.nonce!=='string'||await digest(identity.nonce)!==nonceHash)throw Error('Google identity nonce mismatch.');
 // Google documents both a Boolean and the exact string "true" for this signed claim.
 // Never coerce arbitrary truthy strings, numbers or missing values to verified.
 const emailVerified=identity.email_verified===true||identity.email_verified==='true';
 if(typeof identity.sub!=='string'||!/^[A-Za-z0-9_-]{1,255}$/.test(identity.sub)||!emailVerified||typeof identity.email!=='string'||identity.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email))throw Error('Verified Google email is required.');
 return {sub:identity.sub,email:identity.email.toLowerCase()};
}
