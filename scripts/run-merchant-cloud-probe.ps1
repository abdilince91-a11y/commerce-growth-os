<#
Runs one private, read-only Merchant check on Cloud Run from a clean repository checkout.
Requires an authenticated gcloud.cmd session and project billing. Does not create keys.
Usage: .\scripts\run-merchant-cloud-probe.ps1 -ProjectId PROJECT -MerchantAccountId ACCOUNT -ReaderEmail READER@PROJECT.iam.gserviceaccount.com
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9]{1,32}$')][string]$MerchantAccountId,
    [Parameter(Mandatory = $true)][string]$ReaderEmail,
    [ValidatePattern('^[a-z]+-[a-z]+[0-9]+$')][string]$Region = 'europe-west3'
)

$ErrorActionPreference = 'Stop'
$repoName = 'merchant-read-probe'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Invoke-CheckedGcloud {
    param([string[]]$CommandArgs)
    & gcloud.cmd @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Google Cloud command failed ($($CommandArgs[0..1] -join ' ')). No later step was run."
    }
}

if (-not (Get-Command gcloud.cmd -ErrorAction SilentlyContinue)) {
    throw 'gcloud.cmd is unavailable. Install Google Cloud CLI and sign in locally first.'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is required to verify the exact source commit.'
}
if ($ReaderEmail -cne ($ReaderEmail.ToLowerInvariant()) -or
    $ReaderEmail -cnotmatch ('^[a-z0-9-]+@' + [regex]::Escape($ProjectId) + '\.iam\.gserviceaccount\.com$')) {
    throw 'ReaderEmail must be a service account in the selected Cloud project.'
}

Push-Location $repoRoot
try {
    $changes = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $changes.Count -ne 0) { throw 'Git working tree must be clean before building.' }
    $commit = (git rev-parse --short=12 HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $commit -cnotmatch '^[0-9a-f]{12}$') { throw 'Cannot determine source commit.' }

    $active = @(& gcloud.cmd auth list --filter='status:ACTIVE' --format='value(account)' 2>$null)
    if ($LASTEXITCODE -ne 0 -or $active.Count -ne 1 -or [string]::IsNullOrWhiteSpace($active[0])) {
        throw 'Sign in with gcloud.cmd auth login and retry. Do not share credentials here.'
    }
    $project = @(& gcloud.cmd projects describe $ProjectId '--format=value(projectId)' 2>$null)
    if ($LASTEXITCODE -ne 0 -or $project.Count -ne 1 -or $project[0].Trim() -cne $ProjectId) {
        throw 'The signed-in account cannot access the selected project.'
    }
    $null = & gcloud.cmd iam service-accounts describe $ReaderEmail "--project=$ProjectId" '--format=value(email)' 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Reader service account is unavailable in the selected project.' }

    $enabled = @(& gcloud.cmd services list --enabled "--project=$ProjectId" '--format=value(config.name)' 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot verify enabled APIs in this project.' }
    foreach ($api in @('cloudbuild.googleapis.com', 'artifactregistry.googleapis.com', 'run.googleapis.com', 'merchantapi.googleapis.com')) {
        if ($enabled -cnotcontains $api) { throw "Required API is not enabled: $api" }
    }
    $billing = @(& gcloud.cmd billing projects describe $ProjectId '--format=value(billingEnabled)' 2>$null)
    if ($LASTEXITCODE -ne 0 -or $billing.Count -ne 1 -or $billing[0].Trim() -cne 'True') {
        throw 'Project billing is not confirmed. Cloud Build and Cloud Run can incur charges.'
    }

    $job = "merchant-read-check-$($commit.Substring(0, 7))"
    $jobs = @(& gcloud.cmd run jobs list "--project=$ProjectId" "--region=$Region" '--format=value(metadata.name)' 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot list Cloud Run jobs. Verify permissions and region.' }
    if (@($jobs | Where-Object { $_ -eq $job -or $_ -match ('/' + [regex]::Escape($job) + '$') }).Count -gt 0) {
        throw "Job $job already exists; inspect it before trying another execution."
    }

    $repositories = @(& gcloud.cmd artifacts repositories list "--project=$ProjectId" "--location=$Region" '--format=value(name)' 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot list Artifact Registry repositories.' }
    if (@($repositories | Where-Object { $_ -eq $repoName -or $_ -match ('/repositories/' + [regex]::Escape($repoName) + '$') }).Count -eq 0) {
        Invoke-CheckedGcloud -CommandArgs @('artifacts', 'repositories', 'create', $repoName, '--repository-format=docker', "--location=$Region", "--project=$ProjectId")
    }

    $image = "$Region-docker.pkg.dev/$ProjectId/$repoName/merchant-smoke:$commit"
    $staging = Join-Path ([IO.Path]::GetTempPath()) ("merchant-probe-" + [guid]::NewGuid().ToString('N'))
    try {
        $null = New-Item -ItemType Directory -Force (Join-Path $staging 'src/lib/merchant-readonly')
        $null = New-Item -ItemType Directory -Force (Join-Path $staging 'scripts')
        foreach ($file in @(
            'package.json', 'Dockerfile.merchant-smoke', 'cloudbuild.merchant-smoke.yaml',
            'scripts/merchant-readonly-smoke.ts',
            'src/lib/merchant-readonly/client.ts', 'src/lib/merchant-readonly/cloud-run-token.ts'
        )) {
            Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination (Join-Path $staging $file)
        }
        # Only the six named files above are uploaded; no local .env or OAuth material.
        Invoke-CheckedGcloud -CommandArgs @('builds', 'submit', $staging, '--config=cloudbuild.merchant-smoke.yaml', "--substitutions=_IMAGE=$image", "--project=$ProjectId")
    } finally {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    }

    Invoke-CheckedGcloud -CommandArgs @(
        'run', 'jobs', 'create', $job, "--project=$ProjectId", "--region=$Region", "--image=$image",
        "--service-account=$ReaderEmail", '--tasks=1', '--max-retries=0', '--task-timeout=60s',
        "--set-env-vars=GOOGLE_MERCHANT_ACCOUNT_ID=$MerchantAccountId,GOOGLE_MERCHANT_READER_EMAIL=$ReaderEmail"
    )
    Invoke-CheckedGcloud -CommandArgs @('run', 'jobs', 'execute', $job, "--project=$ProjectId", "--region=$Region", '--wait')
    Write-Host "Cloud Run check finished: $job. Inspect its execution logs for the returned count."
} finally {
    Pop-Location
}
