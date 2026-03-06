const INDEXNOW_API_KEY = '5098d5ba65ef838bbd6d3f293327884b';
const INDEXNOW_KEY_LOCATION = `https://hol.org/${INDEXNOW_API_KEY}.txt`;
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const INDEXNOW_HOST = 'hol.org';

function normalizeUrls(urls) {
  const values = Array.isArray(urls) ? urls : [urls];
  return values.filter((value) => {
    try {
      return new URL(value).hostname === INDEXNOW_HOST;
    } catch {
      return false;
    }
  });
}

export async function submitToIndexNow(urls) {
  const validUrls = normalizeUrls(urls);
  if (validUrls.length === 0) {
    return {
      ok: false,
      status: 400,
      urlCount: 0,
      error: 'No valid hol.org URLs supplied.',
    };
  }

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_API_KEY,
        keyLocation: INDEXNOW_KEY_LOCATION,
        urlList: validUrls,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    return {
      ok: response.status === 200 || response.status === 202,
      status: response.status,
      urlCount: validUrls.length,
      ...(response.status === 200 || response.status === 202
        ? {}
        : { error: `IndexNow returned ${response.status}` }),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      urlCount: validUrls.length,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
