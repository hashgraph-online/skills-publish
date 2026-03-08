import { Client, PrivateKey, Transaction } from '@hashgraph/sdk';
import { fetchBalance, fetchProviders, normalizeBaseUrl, requestJson } from './broker-api.mjs';
import {
  loadCredential,
  maskApiKey,
  resolveCredentialStorePath,
} from './credential-store.mjs';

function parsePositiveNumber(value, label) {
  if (typeof value === 'undefined' || value === null || String(value).trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

function resolveCredential(options) {
  const baseUrl = normalizeBaseUrl(options['api-base-url']);
  const stored = options['api-key']
    ? null
    : loadCredential({
      baseUrl,
      accountId: options['account-id'] ?? '',
      storePath: options['store-path'] ?? '',
    });
  const apiKey = String(options['api-key'] ?? stored?.apiKey ?? '').trim();
  const accountId = String(options['account-id'] ?? stored?.accountId ?? '').trim();
  const network = String(options.network ?? stored?.network ?? '').trim();

  if (!apiKey) {
    throw new Error(
      'Missing API key. Pass --api-key, set RB_API_KEY, or run `npx skill-publish setup --account-id <id> --hedera-private-key <key>`.',
    );
  }

  if (!accountId) {
    throw new Error('Missing account ID. Pass --account-id <id> or reuse a stored credential.');
  }

  return {
    baseUrl,
    apiKey,
    accountId,
    network,
    stored,
  };
}

async function createHbarPurchaseIntent(params) {
  const payload = {
    accountId: params.accountId,
    ...(params.credits ? { credits: params.credits } : {}),
    ...(params.hbarAmount ? { hbarAmount: params.hbarAmount } : {}),
    ...(params.memo ? { memo: params.memo } : {}),
  };
  return requestJson({
    method: 'POST',
    url: `${params.baseUrl}/credits/payments/hbar/intent`,
    headers: {
      'x-api-key': params.apiKey,
      'x-account-id': params.accountId,
    },
    body: payload,
  });
}

async function submitSignedIntent(params) {
  const client = Client.forName(params.network);
  try {
    const transaction = Transaction.fromBytes(Buffer.from(params.intent.transaction, 'base64'));
    const privateKey = PrivateKey.fromString(params.privateKey);
    const signedTransaction = await transaction.sign(privateKey);
    const response = await signedTransaction.execute(client);
    return response.transactionId?.toString() ?? params.intent.transactionId;
  } finally {
    await client.close();
  }
}

async function waitForCreditBalance(params) {
  const timeoutMs = Number.parseInt(String(params.timeoutMs ?? ''), 10);
  const intervalMs = Number.parseInt(String(params.intervalMs ?? ''), 10);
  const maxWaitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90_000;
  const pollEveryMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 4_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= maxWaitMs) {
    const balance = await fetchBalance(params.baseUrl, params.apiKey, params.accountId);
    if (balance > params.previousBalance) {
      return balance;
    }
    await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
  }

  return null;
}

export async function runFundFlow(options) {
  const credential = resolveCredential(options);
  const hbarAmount = parsePositiveNumber(options.hbar, 'HBAR amount');
  const credits = parsePositiveNumber(options.credits, 'Credits');

  if (!hbarAmount && !credits) {
    throw new Error('Provide --hbar <amount> or --credits <amount>.');
  }

  const privateKey = String(options['hedera-private-key'] ?? '').trim();
  if (!privateKey) {
    throw new Error('Missing Hedera private key. Pass --hedera-private-key <key> to sign the funding transaction locally.');
  }

  const network =
    credential.network === 'hedera:mainnet'
      ? 'mainnet'
      : credential.network === 'hedera:testnet'
        ? 'testnet'
        : String(options.network ?? 'hedera:testnet').includes('mainnet')
          ? 'mainnet'
          : 'testnet';

  const balanceBefore = await fetchBalance(
    credential.baseUrl,
    credential.apiKey,
    credential.accountId,
  );

  const intent = await createHbarPurchaseIntent({
    baseUrl: credential.baseUrl,
    apiKey: credential.apiKey,
    accountId: credential.accountId,
    hbarAmount: hbarAmount ?? undefined,
    credits: credits ? Math.round(credits) : undefined,
    memo: String(options.memo ?? '').trim() || undefined,
  });

  const submittedTransactionId = await submitSignedIntent({
    intent,
    privateKey,
    network,
  });

  const balanceAfter = await waitForCreditBalance({
    baseUrl: credential.baseUrl,
    apiKey: credential.apiKey,
    accountId: credential.accountId,
    previousBalance: balanceBefore,
    timeoutMs: options['wait-timeout-ms'],
    intervalMs: options['wait-interval-ms'],
  });

  return {
    mode: 'fund',
    ...credential,
    intent,
    network,
    balanceBefore,
    balanceAfter,
    submittedTransactionId,
  };
}

export async function runWhoamiCommand(options, _positionals, context) {
  const credential = resolveCredential(options);
  const balance = await fetchBalance(credential.baseUrl, credential.apiKey, credential.accountId);
  const providers = await fetchProviders(credential.baseUrl, credential.apiKey, credential.accountId);
  const result = {
    mode: 'whoami',
    baseUrl: credential.baseUrl,
    accountId: credential.accountId,
    network: credential.network || null,
    apiKeyMasked: maskApiKey(credential.apiKey),
    credentialStore: resolveCredentialStorePath(options['store-path'] ?? ''),
    usingStoredCredential: !options['api-key'],
    balance,
    providers,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${context.colors.green('Signed in')}\n`);
  process.stdout.write(`Broker:   ${result.baseUrl}\n`);
  process.stdout.write(`Account:  ${result.accountId}\n`);
  process.stdout.write(`Network:  ${result.network ?? 'unspecified'}\n`);
  process.stdout.write(`API key:  ${result.apiKeyMasked}\n`);
  process.stdout.write(`Stored:   ${result.credentialStore}\n`);
  process.stdout.write(`Balance:  ${result.balance} credits\n`);
}

export async function runCreditsCommand(options, _positionals, context) {
  const credential = resolveCredential(options);
  const [balance, providers] = await Promise.all([
    fetchBalance(credential.baseUrl, credential.apiKey, credential.accountId),
    fetchProviders(credential.baseUrl, credential.apiKey, credential.accountId),
  ]);

  const result = {
    mode: 'credits',
    baseUrl: credential.baseUrl,
    accountId: credential.accountId,
    balance,
    providers,
    billingUrl: `${credential.baseUrl.replace(/\/api\/v1$/u, '')}/billing`,
    docsUrl: `${credential.baseUrl.replace(/\/api\/v1$/u, '')}/docs?tab=credits`,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${context.colors.bold('Credits')}\n`);
  process.stdout.write(`Account: ${result.accountId}\n`);
  process.stdout.write(`Balance: ${result.balance} credits\n`);
  process.stdout.write(`Billing: ${result.billingUrl}\n`);
  process.stdout.write(`Docs:    ${result.docsUrl}\n`);
}

export async function runFundCommand(options, _positionals, context) {
  const result = await runFundFlow(options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${context.colors.green('Funding submitted')}\n`);
  process.stdout.write(`Account:      ${result.accountId}\n`);
  process.stdout.write(`Network:      ${result.network}\n`);
  process.stdout.write(`Balance:      ${result.balanceBefore} -> ${result.balanceAfter ?? 'pending'} credits\n`);
  process.stdout.write(`HBAR:         ${result.intent.hbarAmount}\n`);
  process.stdout.write(`Credits:      ${result.intent.credits}\n`);
  process.stdout.write(`Purchase ID:  ${result.intent.purchaseId ?? 'n/a'}\n`);
  process.stdout.write(`Transaction:  ${result.submittedTransactionId}\n`);
  if (result.balanceAfter === null) {
    process.stdout.write(
      `${context.colors.yellow('Credits are still reconciling')}. Re-run \`npx skill-publish credits\` in a minute to confirm the new balance.\n`,
    );
  }
}
