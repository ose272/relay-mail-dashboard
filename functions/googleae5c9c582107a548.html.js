// Keep the exact Google-provided verification response publicly accessible.
export function onRequest() {
  return new Response('google-site-verification: googleae5c9c582107a548.html', {
    headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}
  });
}
