// Pages _headers applies only to static assets, so APIs need their own headers.
export async function onRequest(context){
  const response=await context.next();
  const secured=new Response(response.body,response);
  secured.headers.set('X-Content-Type-Options','nosniff');
  secured.headers.set('Referrer-Policy','no-referrer');
  secured.headers.set('X-Frame-Options','DENY');
  return secured;
}
