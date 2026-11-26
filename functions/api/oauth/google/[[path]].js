import {customerGoogleOAuth} from '../../../_lib/customer-google-oauth.js';
export function onRequest(context){return customerGoogleOAuth(context);}
