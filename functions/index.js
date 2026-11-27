import {onRequest as sendarPage} from './sendar/[[path]].js';
export const onRequest=context=>sendarPage({...context,request:new Request(new URL('/sendar/about',context.request.url),{method:context.request.method})});
