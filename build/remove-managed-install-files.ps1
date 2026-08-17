param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CurrentManifestPath,

  [Parameter(Mandatory = $true)]
  [string]$NextManifestPath
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
    if (!$seen.Add($relativePath)) {
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
    $resolved[$relativePath] = $targetPath
  }
  return $resolved
}

try {
  $currentFiles = Read-InstallManifest $CurrentManifestPath
  $nextFiles = Read-InstallManifest $NextManifestPath
  $current = Resolve-ManagedFiles $InstallDirectory $currentFiles
  $next = Resolve-ManagedFiles $InstallDirectory $nextFiles
  $nextKeys = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  foreach ($relativePath in $next.Keys) {
    [void]$nextKeys.Add($relativePath)
  }

  $directories = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  $normalizedRoot = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $removed = 0
  foreach ($relativePath in $current.Keys) {
    if ($nextKeys.Contains($relativePath)) {
      continue
    }
    $targetPath = $current[$relativePath]
    if (Test-Path -LiteralPath $targetPath -PathType Container) {
      throw "Managed file path is a directory: $relativePath"
    }
    if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
      Remove-Item -LiteralPath $targetPath -Force
      $removed += 1
    }

    $parent = [IO.Path]::GetDirectoryName($targetPath)
    while ($parent -and !$parent.Equals(
      $normalizedRoot,
      [StringComparison]::OrdinalIgnoreCase
    )) {
      [void]$directories.Add($parent)
      $parent = [IO.Path]::GetDirectoryName($parent)
    }
  }

  $sortedDirectories = @($directories) |
    Sort-Object { $_.Length } -Descending
  foreach ($directory in $sortedDirectories) {
    if (!(Test-Path -LiteralPath $directory -PathType Container)) {
      continue
    }
    $firstChild = Get-ChildItem -LiteralPath $directory -Force |
      Select-Object -First 1
    if ($null -eq $firstChild) {
      Remove-Item -LiteralPath $directory -Force
    }
  }

  Write-Output "Removed $removed obsolete managed files"
  exit 0
} catch {
  Write-Error $_
  exit 1
}
