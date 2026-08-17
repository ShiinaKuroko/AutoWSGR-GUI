param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CurrentManifestPath,

  [Parameter(Mandatory = $true)]
  [string]$NextManifestPath,

  [ValidateSet('Validate', 'Finalize')]
  [string]$Mode = 'Finalize',

  [string]$BackupDirectory = ''
)

$ErrorActionPreference = 'Stop'
$movedFiles = [Collections.Generic.List[object]]::new()
$cleanupCommitted = $false
$normalizedBackup = $null

function Read-InstallManifest {
  param([string]$ManifestPath)

  $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 |
    ConvertFrom-Json
  if ($manifest.schemaVersion -ne 2) {
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

  foreach ($entry in $RelativePaths) {
    $value = $entry.path
    $sha256 = $entry.sha256
    if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value)) {
      throw 'Install manifest contains an invalid file path'
    }
    if ($sha256 -isnot [string] -or $sha256 -notmatch '^[0-9a-fA-F]{64}$') {
      throw "Install manifest contains an invalid SHA-256: $value"
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
    $resolved[$canonicalRelativePath] = [PSCustomObject]@{
      RelativePath = $canonicalRelativePath
      TargetPath = $targetPath
      Sha256 = $sha256.ToLowerInvariant()
    }
  }
  return $resolved
}

function Restore-MovedFiles {
  $errors = [Collections.Generic.List[string]]::new()
  for ($index = $movedFiles.Count - 1; $index -ge 0; $index -= 1) {
    $moved = $movedFiles[$index]
    try {
      if (!(Test-Path -LiteralPath $moved.BackupPath -PathType Leaf)) {
        continue
      }
      if (Test-Path -LiteralPath $moved.TargetPath) {
        throw "Rollback target already exists: $($moved.TargetPath)"
      }
      $parent = [IO.Path]::GetDirectoryName($moved.TargetPath)
      [void][IO.Directory]::CreateDirectory($parent)
      Move-Item -LiteralPath $moved.BackupPath `
        -Destination $moved.TargetPath
    } catch {
      $errors.Add($_.Exception.Message)
    }
  }
  if ($errors.Count -gt 0) {
    throw "Managed file rollback failed: $($errors -join '; ')"
  }
}

try {
  $currentFiles = Read-InstallManifest $CurrentManifestPath
  $nextFiles = Read-InstallManifest $NextManifestPath
  $current = Resolve-ManagedFiles $InstallDirectory $currentFiles
  $next = Resolve-ManagedFiles $InstallDirectory $nextFiles
  if ($Mode -eq 'Validate') {
    Write-Output (
      "Validated install manifests: current=$($current.Count), " +
      "next=$($next.Count)"
    )
    exit 0
  }

  $added = 0
  $updated = 0
  $unchanged = 0
  foreach ($relativePath in $next.Keys) {
    $entry = $next[$relativePath]
    if (!$current.ContainsKey($relativePath)) {
      $added += 1
    } elseif ($current[$relativePath].Sha256 -eq $entry.Sha256) {
      $unchanged += 1
      continue
    } else {
      $updated += 1
    }

    if (!(Test-Path -LiteralPath $entry.TargetPath -PathType Leaf)) {
      throw "Installed managed file is missing: $relativePath"
    }
    $actualHash = (Get-FileHash -LiteralPath $entry.TargetPath `
      -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $entry.Sha256) {
      throw "Installed managed file hash mismatch: $relativePath"
    }
  }

  $normalizedRoot = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
    $BackupDirectory = "$normalizedRoot.autowsgr-update-backup"
  }
  $normalizedBackup = [IO.Path]::GetFullPath($BackupDirectory).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $expectedBackup = "$normalizedRoot.autowsgr-update-backup"
  if (!$normalizedBackup.Equals(
    $expectedBackup,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Managed file backup path is invalid: $BackupDirectory"
  }
  if (Test-Path -LiteralPath $normalizedBackup) {
    throw "Managed file backup path already exists: $normalizedBackup"
  }

  $directories = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  $removed = 0
  foreach ($relativePath in $current.Keys) {
    if ($next.ContainsKey($relativePath)) {
      continue
    }
    $targetPath = $current[$relativePath].TargetPath
    if (Test-Path -LiteralPath $targetPath -PathType Container) {
      throw "Managed file path is a directory: $relativePath"
    }
    if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
      $backupPath = [IO.Path]::Combine(
        $normalizedBackup,
        $relativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
      )
      $backupParent = [IO.Path]::GetDirectoryName($backupPath)
      [void][IO.Directory]::CreateDirectory($backupParent)
      Move-Item -LiteralPath $targetPath -Destination $backupPath
      $movedFiles.Add([PSCustomObject]@{
        TargetPath = $targetPath
        BackupPath = $backupPath
      })
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

  $cleanupCommitted = $true
  if (Test-Path -LiteralPath $normalizedBackup) {
    try {
      Remove-Item -LiteralPath $normalizedBackup -Recurse -Force
    } catch {
      Write-Warning "Managed backup cleanup failed: $($_.Exception.Message)"
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
      try {
        Remove-Item -LiteralPath $directory -Force
      } catch {
        Write-Warning "Empty directory cleanup failed: $directory"
      }
    }
  }

  Write-Output (
    "Finalized managed files: added=$added, updated=$updated, " +
    "unchanged=$unchanged, removed=$removed"
  )
  exit 0
} catch {
  $failure = $_
  if (!$cleanupCommitted -and $movedFiles.Count -gt 0) {
    try {
      Restore-MovedFiles
      if ($null -ne $normalizedBackup -and (
        Test-Path -LiteralPath $normalizedBackup
      )) {
        Remove-Item -LiteralPath $normalizedBackup -Recurse -Force
      }
    } catch {
      Write-Error "$failure; $($_.Exception.Message)"
      exit 1
    }
  }
  Write-Error $failure
  exit 1
}
