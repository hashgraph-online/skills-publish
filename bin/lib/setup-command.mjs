import { fetchBalance, normalizeBaseUrl, requestJson } from './broker-api.mjs';
import { maskApiKey, saveCredential } from './credential-store.mjs';
import { runFundFlow } from './account-commands.mjs';

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
  const creditsAmount = parsePositiveNumber(options.credits, 0);

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
  if (hbarAmount > 0 || creditsAmount > 0) {
    try {
      const fundingResult = await runFundFlow({
        ...options,
        'api-base-url': baseUrl,
        'api-key': apiKey,
        'account-id': accountId,
        network,
        hbar: hbarAmount > 0 ? hbarAmount : undefined,
        credits: creditsAmount > 0 ? creditsAmount : undefined,
      });
      funding = {
        hbarAmount: fundingResult.intent.hbarAmount,
        credited:
          fundingResult.balanceAfter !== null
            ? Math.max(0, fundingResult.balanceAfter - fundingResult.balanceBefore)
            : null,
        balanceAfterFunding: fundingResult.balanceAfter,
        transactionId: fundingResult.submittedTransactionId,
        purchaseId: fundingResult.intent.purchaseId ?? null,
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
