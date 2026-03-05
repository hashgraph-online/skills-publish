import { maskApiKey, saveCredential } from './credential-store.mjs';

const DEFAULT_BASE_URL = 'https://hol.org/registry/api/v1';

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }
  const withoutTrailing = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  if (withoutTrailing.endsWith('/api/v1')) {
    return withoutTrailing;
  }
  if (withoutTrailing.endsWith('/registry')) {
    return `${withoutTrailing}/api/v1`;
  }
  return `${withoutTrailing}/api/v1`;
}

function normalizeLedgerNetwork(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) {
    return 'hedera:testnet';
  }
  if (raw === 'testnet' || raw === 'hedera-testnet') {
    return 'hedera:testnet';
  }
  if (raw === 'mainnet' || raw === 'hedera-mainnet') {
    return 'hedera:mainnet';
  }
  return raw;
}

function parsePositiveNumber(value, fallback = 0) {
  if (typeof value === 'undefined' || value === null || String(value).trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number but received "${String(value)}".`);
  }
  return parsed;
}

async function summarizeErrorBody(response) {
  const text = await response.text();
  if (!text) {
    return '';
  }
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

async function requestJson(params) {
  const headers = {
    'content-type': 'application/json',
  };
  if (params.apiKey) {
    headers['x-api-key'] = params.apiKey;
  }
  if (params.accountId) {
    headers['x-account-id'] = params.accountId;
  }
  const response = await fetch(params.url, {
    method: params.method,
    headers,
    body: params.body ? JSON.stringify(params.body) : undefined,
  });
  if (!response.ok) {
    const bodySummary = await summarizeErrorBody(response);
    throw new Error(
      `${params.method} ${params.url} failed with ${response.status}${bodySummary ? `: ${bodySummary}` : ''}`,
    );
  }
  return response.json();
}

async function signWithHederaPrivateKey(message, privateKeyValue) {
  const sdk = await import('@hashgraph/sdk');
  const privateKey = sdk.PrivateKey.fromString(privateKeyValue);
  const signatureBytes = privateKey.sign(Buffer.from(message, 'utf8'));
  return {
    signature: Buffer.from(signatureBytes).toString('base64'),
    signatureKind: 'raw',
    publicKey: privateKey.publicKey.toString(),
  };
}

async function createLedgerApiKey(params) {
  const challenge = await requestJson({
    method: 'POST',
    url: `${params.baseUrl}/auth/ledger/challenge`,
    body: {
      accountId: params.accountId,
      network: params.network,
    },
  });

  if (!challenge || typeof challenge !== 'object' || typeof challenge.challengeId !== 'string' || typeof challenge.message !== 'string') {
    throw new Error('Invalid ledger challenge response from broker.');
  }

  const signaturePayload =
    params.signature && String(params.signature).trim().length > 0
      ? {
          signature: String(params.signature).trim(),
          signatureKind: String(params.signatureKind || 'raw').trim(),
          publicKey:
            typeof params.publicKey === 'string' && params.publicKey.trim().length > 0
              ? params.publicKey.trim()
              : undefined,
        }
      : await signWithHederaPrivateKey(challenge.message, params.hederaPrivateKey);

  const verification = await requestJson({
    method: 'POST',
    url: `${params.baseUrl}/auth/ledger/verify`,
    body: {
      challengeId: challenge.challengeId,
      accountId: params.accountId,
      network: params.network,
      signature: signaturePayload.signature,
      signatureKind: signaturePayload.signatureKind,
      ...(signaturePayload.publicKey ? { publicKey: signaturePayload.publicKey } : {}),
      ...(typeof params.expiresInMinutes === 'number' ? { expiresInMinutes: params.expiresInMinutes } : {}),
    },
  });

  if (!verification || typeof verification !== 'object' || typeof verification.key !== 'string') {
    throw new Error('Invalid ledger verification response from broker.');
  }

  return verification;
}

async function fetchBalance(baseUrl, apiKey, accountId) {
  const query = new URLSearchParams({ accountId });
  const response = await requestJson({
    method: 'GET',
    url: `${baseUrl}/credits/balance?${query.toString()}`,
    apiKey,
    accountId,
  });
  const balance = Number(response?.balance ?? 0);
  return Number.isFinite(balance) ? balance : 0;
}

async function purchaseCreditsWithHbar(params) {
  throw new Error(
    `Automatic CLI funding is currently disabled for security. Requested ${params.hbarAmount} HBAR top-up. ` +
      'Use the broker billing flow to purchase credits without transmitting a private key.',
  );
}

export async function runSetupFlow(options) {
  const baseUrl = normalizeBaseUrl(options['api-base-url']);
  const accountId = String(options['account-id'] ?? '').trim();
  if (!accountId) {
    throw new Error('Missing account ID. Pass --account-id <id>.');
  }
  const network = normalizeLedgerNetwork(options.network);
  const hederaPrivateKey = String(options['hedera-private-key'] ?? '').trim();
  const signature = String(options.signature ?? '').trim();
  if (!hederaPrivateKey && !signature) {
    throw new Error(
      'Provide --hedera-private-key <key> for automatic signing or --signature <value> for manual signing.',
    );
  }
  const expiresInMinutes = parsePositiveNumber(options['expires-in-minutes'], 60);
  const hbarAmount = parsePositiveNumber(options.hbar, 0);

  const verification = await createLedgerApiKey({
    baseUrl,
    accountId,
    network,
    hederaPrivateKey,
    signature,
    signatureKind: options['signature-kind'],
    publicKey: options['public-key'],
    expiresInMinutes,
  });

  const apiKey = String(verification.key).trim();
  if (!apiKey) {
    throw new Error('Ledger verification succeeded but no API key was returned.');
  }

  let savedPath = '';
  if (!options['no-save']) {
    savedPath = saveCredential({
      baseUrl,
      accountId,
      apiKey,
      network,
      storePath: options['store-path'],
    });
  }

  const balanceBeforeFunding = await fetchBalance(baseUrl, apiKey, accountId);

  let funding = null;
  let fundingError = '';
  if (hbarAmount > 0) {
    if (!hederaPrivateKey) {
      throw new Error('HBAR top-up requires --hedera-private-key for signed payment.');
    }
    try {
      const fundingResult = await purchaseCreditsWithHbar({
        baseUrl,
        apiKey,
        accountId,
        hbarAmount,
        hederaPrivateKey,
        memo: String(options.memo ?? '').trim(),
      });
      const currentBalance = await fetchBalance(baseUrl, apiKey, accountId);
      funding = {
        hbarAmount,
        credited: fundingResult.credited,
        balanceAfterFunding: currentBalance,
        transactionId: fundingResult.transactionId,
      };
    } catch (error) {
      fundingError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    mode: 'setup',
    baseUrl,
    accountId,
    network,
    apiKey,
    apiKeyMasked: maskApiKey(apiKey),
    apiKeySummary:
      verification && typeof verification.apiKey === 'object' && verification.apiKey
        ? verification.apiKey
        : null,
    savedPath,
    balanceBeforeFunding,
    funding,
    fundingError,
    docs: {
      apiKeys: `${baseUrl.replace(/\/api\/v1$/u, '')}/docs?tab=api-keys`,
      credits: `${baseUrl.replace(/\/api\/v1$/u, '')}/docs?tab=credits`,
    },
  };
}
