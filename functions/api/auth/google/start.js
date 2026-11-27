import {googleLoginStart} from '../../../_lib/google-login.js';
export const onRequest=async context=>{try{return await googleLoginStart(context);}catch{return Response.json({error:'Google sign-in could not start. Retry shortly.'},{status:503,headers:{'Cache-Control':'no-store'}});}};
