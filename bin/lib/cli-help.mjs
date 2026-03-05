export const COMMAND_ALIASES = new Map([
  ['publish', 'publish'],
  ['pub', 'publish'],
  ['p', 'publish'],
  ['validate', 'validate'],
  ['check', 'validate'],
  ['v', 'validate'],
  ['quote', 'quote'],
  ['q', 'quote'],
  ['init', 'init'],
  ['create', 'init'],
  ['i', 'init'],
  ['setup', 'setup'],
  ['auth', 'setup'],
  ['s', 'setup'],
  ['setup-action', 'setup-action'],
  ['action', 'setup-action'],
  ['workflow', 'setup-action'],
  ['gha', 'setup-action'],
  ['scaffold-repo', 'scaffold-repo'],
  ['scaffold', 'scaffold-repo'],
  ['new', 'scaffold-repo'],
  ['bootstrap', 'scaffold-repo'],
  ['doctor', 'doctor'],
  ['diag', 'doctor'],
  ['d', 'doctor'],
  ['start', 'start'],
  ['wizard', 'start'],
  ['help', 'help'],
]);

export function buildGlobalHelp(version) {
  return `skill-publish ${String(version)}

Usage:
  npx skill-publish [command] [options]
  npx skill-publish [legacy publish flags]

Getting Started:
  start               Interactive quick start (default in TTY)
  setup               Create API key via ledger auth and optionally fund credits
  doctor [dir]        Run readiness checks for environment + skill package
  setup-action [dir]  Add a GitHub publish workflow to an existing skill repo
  scaffold-repo [dir] Scaffold a new skill repo with package + workflow

Core Commands:
  init [dir]          Scaffold SKILL.md + skill.json
  validate [dir]      Validate a skill package locally
  quote [dir]         Validate package and fetch publish quote
  publish [dir]       Validate, quote, and publish a skill package
  help [command]      Show help for a command

Examples:
  npx skill-publish
  npx skill-publish start
  npx skill-publish setup --account-id 0.0.12345 --hedera-private-key <key> --hbar 5
  npx skill-publish setup-action . --skill-dir skills/my-skill
  npx skill-publish scaffold-repo ./weather-skill --name weather-skill
  npx skill-publish doctor ./skills/weather-skill
  npx skill-publish init ./skills/weather-skill
  npx skill-publish validate ./skills/weather-skill
  npx skill-publish quote ./skills/weather-skill
  npx skill-publish publish ./skills/weather-skill

Legacy usage still works:
  RB_API_KEY=rbk_xxx npx skill-publish --skill-dir ./skills/weather-skill

Global flags:
  -h, --help            Show help
  -v, --version         Show CLI version
  --no-color            Disable ANSI colors
  --non-interactive     Disable interactive prompts
`;
}

export const HELP_BY_COMMAND = {
  start: `skill-publish start

Runs an interactive quick-start flow for setup, scaffolding, validation, and publishing.

Options:
  --non-interactive     Print help instead of prompts
  --no-color            Disable ANSI colors
`,
  publish: `skill-publish publish [dir]

Publishes a skill package to the Registry Broker.

Options:
  --api-key <key>              API key (or RB_API_KEY env var)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --account-id <id>            Optional Hedera account ID
  --name <name>                Override name from skill.json
  --version <version>          Override version from skill.json
  --annotate <bool>            Enable annotations (default: false in CLI)
  --no-annotate                Disable annotations
  --stamp-repo-commit <bool>   Stamp repo/commit metadata (default: true)
  --no-stamp-repo-commit       Disable repo/commit stamping
  --poll-timeout-ms <ms>       Publish poll timeout (default: 720000)
  --poll-interval-ms <ms>      Publish poll interval (default: 4000)
  --dry-run                    Run validation only if no key, otherwise run quote
  --json                       Print machine-readable summary
`,
  validate: `skill-publish validate [dir]

Validates package files and skill metadata without publishing.

Options:
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --name <name>                Override name from skill.json
  --version <version>          Override version from skill.json
  --json                       Print machine-readable summary
`,
  quote: `skill-publish quote [dir]

Validates package and requests a publish quote without creating a publish job.

Options:
  --api-key <key>              API key (or RB_API_KEY env var)
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --account-id <id>            Optional Hedera account ID
  --name <name>                Override name from skill.json
  --version <version>          Override version from skill.json
  --json                       Print machine-readable summary
`,
  init: `skill-publish init [dir]

Scaffolds a new skill package with SKILL.md + skill.json.

Options:
  --name <name>                Skill name (defaults to folder name)
  --description <text>         Skill description
  --version <version>          Version (default: 1.0.0)
  --force                      Overwrite existing files
  --yes                        Alias for --force
`,
  setup: `skill-publish setup

Creates an API key using ledger challenge/verify and can top up credits in one step.

Options:
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --account-id <id>            Hedera account ID for key ownership
  --network <value>            Ledger network (default: hedera:testnet)
  --hedera-private-key <key>   Hedera private key used to sign challenge
  --signature <value>          Manual signature payload (advanced mode)
  --signature-kind <kind>      Signature kind: raw, map, evm (default: raw)
  --public-key <value>         Optional public key when using manual signature
  --expires-in-minutes <n>     API key TTL in minutes (1-60, default: 60)
  --hbar <amount>              Optional HBAR amount to purchase credits immediately
  --memo <text>                Optional purchase memo for top-up
  --store-path <path>          Optional path for local credential store
  --no-save                    Do not persist API key to local credential store
  --json                       Print machine-readable summary
`,
  'setup-action': `skill-publish setup-action [repoDir]

Adds a skill-publish GitHub Actions workflow to an existing skill repository.

Options:
  --repo-dir <dir>             Repository directory (or pass [repoDir] positional)
  --skill-dir <dir>            Skill package directory (auto-detected if omitted)
  --workflow-path <path>       Workflow output path (default: .github/workflows/publish-skill.yml)
  --trigger <mode>             Workflow trigger: release | manual (default: release)
  --annotate <bool>            Enable release/PR annotations (default: true)
  --force                      Overwrite existing workflow file
`,
  'scaffold-repo': `skill-publish scaffold-repo [repoDir]

Scaffolds a new skill repository with package files and publish workflow.

Options:
  --repo-dir <dir>             Repository directory (or pass [repoDir] positional)
  --name <name>                Skill name (defaults to folder name)
  --description <text>         Skill description
  --version <version>          Skill version (default: 1.0.0)
  --skill-dir <dir>            Skill package directory (default: skills/<name>)
  --workflow-path <path>       Workflow output path (default: .github/workflows/publish-skill.yml)
  --trigger <mode>             Workflow trigger: release | manual (default: release)
  --annotate <bool>            Enable release/PR annotations (default: true)
  --force                      Allow scaffolding into a non-empty directory
`,
  doctor: `skill-publish doctor [dir]

Runs local readiness checks for environment, broker reachability, credentials, and skill package files.

Options:
  --api-base-url <url>         API base URL (default: https://hol.org/registry/api/v1)
  --api-key <key>              API key (or RB_API_KEY env var / local credential store)
  --account-id <id>            Hedera account ID for balance checks
  --skill-dir <dir>            Skill directory; [dir] positional also supported
  --store-path <path>          Optional path for local credential store
  --json                       Print machine-readable summary
`,
};
