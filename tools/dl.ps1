param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)
$scriptPath = Join-Path $PSScriptRoot "social-post-dl.py"
python $scriptPath @ArgsList
