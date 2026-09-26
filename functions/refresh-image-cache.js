export async function onRequest() {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Image cache refreshed</title>
</head>
<body>
  <p>Kollection image cache cleared. You can close this tab.</p>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "Clear-Site-Data": '"cache"',
      },
    }
  );
}
