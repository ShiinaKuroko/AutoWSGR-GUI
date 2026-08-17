param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDirectory,

  [Parameter(Mandatory = $true)]
  [string]$PreviousManifestPath,

  [Parameter(Mandatory = $true)]
  [string]$CurrentManifestPath
)

$ErrorActionPreference = 'Stop'

function Read-InstallManifest {
  param([string]$ManifestPath)

  $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 |
    ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1) {
    throw "Unsupported install manifest schema: $($manifest.schemaVersion)"
  }
  if ($null -eq $manifest.files) {
    throw "Install manifest has no files array: $ManifestPath"
  }
  return @($manifest.files)
}

function Resolve-ManagedFiles {
  param(
    [string]$Root,
    [object[]]$RelativePaths
  )

  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $rootPrefix = "$rootPath$([IO.Path]::DirectorySeparatorChar)"
  $seen = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  $resolved = @{}

  foreach ($value in $RelativePaths) {
    if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value)) {
      throw 'Install manifest contains an invalid file path'
    }
    if ([IO.Path]::IsPathRooted($value)) {
      throw "Install manifest contains an absolute path: $value"
    }

    $relativePath = $value.Replace(
      [IO.Path]::AltDirectorySeparatorChar,
      [IO.Path]::DirectorySeparatorChar
    )
    $targetPath = [IO.Path]::GetFullPath(
      [IO.Path]::Combine($rootPath, $relativePath)
    )
    if (!$targetPath.StartsWith(
      $rootPrefix,
      [StringComparison]::OrdinalIgnoreCase
    )) {
      throw "Install manifest path escapes the install directory: $value"
    }

    $canonicalRelativePath = $targetPath.Substring($rootPrefix.Length)
    $canonicalRelativePath = $canonicalRelativePath.Replace(
      [IO.Path]::DirectorySeparatorChar,
      '/'
    )
    if (!$canonicalRelativePath.Equals(
      $value.Replace('\', '/'),
      [StringComparison]::Ordinal
    )) {
      throw "Install manifest path is not normalized: $value"
    }
    if (!$seen.Add($canonicalRelativePath)) {
      throw "Install manifest contains a duplicate path: $value"
    }

    $cursor = $rootPath
    foreach ($segment in $relativePath.Split(
      @(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
      ),
      [StringSplitOptions]::RemoveEmptyEntries
    )) {
      $cursor = [IO.Path]::Combine($cursor, $segment)
      if (Test-Path -LiteralPath $cursor) {
        $item = Get-Item -LiteralPath $cursor -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
          throw "Install manifest path crosses a reparse point: $value"
        }
      }
    }

    $resolved[$canonicalRelativePath] = $targetPath
  }
  return $resolved
}

try {
  $previous = Resolve-ManagedFiles $InstallDirectory (
    Read-InstallManifest $PreviousManifestPath
  )
  $current = Resolve-ManagedFiles $InstallDirectory (
    Read-InstallManifest $CurrentManifestPath
  )

  $removed = 0
  $missing = 0
  foreach ($relativePath in $previous.Keys) {
    if ($current.ContainsKey($relativePath)) {
      continue
    }

    $targetPath = $previous[$relativePath]
    if (Test-Path -LiteralPath $targetPath -PathType Container) {
      throw "Managed file path is a directory: $relativePath"
    }
    if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
      Remove-Item -LiteralPath $targetPath -Force
      $removed += 1
    } else {
      $missing += 1
    }
  }

  Write-Output (
    "Removed obsolete managed files: removed=$removed, missing=$missing"
  )
  exit 0
} catch {
  Write-Error $_
  exit 1
}
