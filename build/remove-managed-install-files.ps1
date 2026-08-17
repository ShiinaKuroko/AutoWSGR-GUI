param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDirectory,

  [Parameter(Mandatory = $true)]
  [string]$PreviousManifestPath,

  [Parameter(Mandatory = $true)]
  [string]$CurrentManifestPath,

  [ValidateSet('PrepareShape', 'RestoreShape', 'Finalize')]
  [string]$Mode = 'Finalize',

  [string]$ShapeBackupDirectory = ''
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

function Resolve-ShapeBackupDirectory {
  param(
    [string]$Root,
    [string]$BackupDirectory
  )

  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $expected = "$rootPath.autowsgr-shape-update"
  $resolved = [IO.Path]::GetFullPath($BackupDirectory).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  if (!$resolved.Equals(
    $expected,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Install shape backup path is invalid: $BackupDirectory"
  }
  return $resolved
}

function Get-ManagedDirectories {
  param([Collections.IDictionary]$Files)

  $directories = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  foreach ($relativePath in $Files.Keys) {
    $segments = $relativePath.Split('/')
    for ($length = 1; $length -lt $segments.Length; $length += 1) {
      [void]$directories.Add(
        [string]::Join('/', $segments[0..($length - 1)])
      )
    }
  }
  return ,$directories
}

function Convert-ToRelativePath {
  param(
    [string]$Root,
    [string]$Target
  )

  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $rootPrefix = "$rootPath$([IO.Path]::DirectorySeparatorChar)"
  $targetPath = [IO.Path]::GetFullPath($Target)
  if (!$targetPath.StartsWith(
    $rootPrefix,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Install path escapes the install directory: $Target"
  }
  return $targetPath.Substring($rootPrefix.Length).Replace(
    [IO.Path]::DirectorySeparatorChar,
    '/'
  )
}

function Assert-ManagedDirectory {
  param(
    [string]$Root,
    [string]$Directory,
    [Collections.IDictionary]$PreviousFiles,
    [Collections.Generic.HashSet[string]]$PreviousDirectories
  )

  foreach ($item in Get-ChildItem -LiteralPath $Directory -Force -Recurse) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Install shape conflict crosses a reparse point: $($item.FullName)"
    }
    $relativePath = Convert-ToRelativePath $Root $item.FullName
    if ($item.PSIsContainer) {
      if (!$PreviousDirectories.Contains($relativePath)) {
        throw "Install shape conflict contains an unmanaged directory: $relativePath"
      }
    } elseif (!$PreviousFiles.ContainsKey($relativePath)) {
      throw "Install shape conflict contains an unmanaged file: $relativePath"
    }
  }
}

function Restore-ShapeBackup {
  param(
    [string]$Root,
    [string]$BackupDirectory
  )

  if (!(Test-Path -LiteralPath $BackupDirectory -PathType Container)) {
    return
  }
  $journalPath = [IO.Path]::Combine(
    $BackupDirectory,
    '.shape-conflicts.json'
  )
  if (!(Test-Path -LiteralPath $journalPath -PathType Leaf)) {
    throw "Install shape backup journal is missing: $BackupDirectory"
  }
  $relativePaths = @(
    Get-Content -LiteralPath $journalPath -Raw -Encoding UTF8 |
      ConvertFrom-Json
  )
  $targets = Resolve-ManagedFiles $Root $relativePaths
  foreach ($relativePath in $relativePaths) {
    $backupPath = [IO.Path]::Combine(
      $BackupDirectory,
      $relativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
    )
    $targetPath = $targets[$relativePath]
    if (!(Test-Path -LiteralPath $backupPath)) {
      if (Test-Path -LiteralPath $targetPath) {
        continue
      }
      throw "Install shape backup item is missing: $relativePath"
    }
    if (Test-Path -LiteralPath $targetPath) {
      $targetItem = Get-Item -LiteralPath $targetPath -Force
      if ($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Install shape restore target is a reparse point: $relativePath"
      }
      Remove-Item -LiteralPath $targetPath -Recurse -Force
    }
    $parent = [IO.Path]::GetDirectoryName($targetPath)
    [void][IO.Directory]::CreateDirectory($parent)
    Copy-Item -LiteralPath $backupPath -Destination $targetPath -Recurse
  }
  Remove-Item -LiteralPath $BackupDirectory -Recurse -Force
}

function Prepare-ShapeConflicts {
  param(
    [string]$Root,
    [Collections.IDictionary]$PreviousFiles,
    [Collections.IDictionary]$CurrentFiles,
    [string]$BackupDirectory
  )

  if (Test-Path -LiteralPath $BackupDirectory) {
    Restore-ShapeBackup $Root $BackupDirectory
  }

  $previousDirectories = Get-ManagedDirectories $PreviousFiles
  $currentDirectories = Get-ManagedDirectories $CurrentFiles
  $conflicts = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  foreach ($relativePath in $PreviousFiles.Keys) {
    if ($currentDirectories.Contains($relativePath)) {
      [void]$conflicts.Add($relativePath)
    }
  }
  foreach ($relativePath in $CurrentFiles.Keys) {
    if ($previousDirectories.Contains($relativePath)) {
      [void]$conflicts.Add($relativePath)
    }
  }

  $moves = [Collections.Generic.List[object]]::new()
  foreach ($relativePath in $conflicts) {
    $target = (Resolve-ManagedFiles $Root @($relativePath))[$relativePath]
    if (!(Test-Path -LiteralPath $target)) {
      continue
    }
    $item = Get-Item -LiteralPath $target -Force
    $newPathIsDirectory = $currentDirectories.Contains($relativePath)
    if ($newPathIsDirectory -and $item.PSIsContainer) {
      continue
    }
    if (!$newPathIsDirectory -and !$item.PSIsContainer) {
      continue
    }
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Install shape conflict is a reparse point: $relativePath"
    }
    if ($item.PSIsContainer) {
      Assert-ManagedDirectory `
        $Root `
        $target `
        $PreviousFiles `
        $previousDirectories
    }
    $moves.Add([PSCustomObject]@{
      RelativePath = $relativePath
      TargetPath = $target
    })
  }
  if ($moves.Count -eq 0) {
    return
  }

  [void][IO.Directory]::CreateDirectory($BackupDirectory)
  $journalPath = [IO.Path]::Combine(
    $BackupDirectory,
    '.shape-conflicts.json'
  )
  @($moves | ForEach-Object { $_.RelativePath }) |
    ConvertTo-Json |
    Set-Content -LiteralPath $journalPath -Encoding UTF8
  try {
    foreach ($move in $moves) {
      $backupPath = [IO.Path]::Combine(
        $BackupDirectory,
        $move.RelativePath.Replace(
          '/',
          [IO.Path]::DirectorySeparatorChar
        )
      )
      $parent = [IO.Path]::GetDirectoryName($backupPath)
      [void][IO.Directory]::CreateDirectory($parent)
      Move-Item -LiteralPath $move.TargetPath -Destination $backupPath
    }
  } catch {
    $failure = $_
    Restore-ShapeBackup $Root $BackupDirectory
    throw $failure
  }
}

try {
  if ($Mode -eq 'RestoreShape') {
    $shapeBackup = Resolve-ShapeBackupDirectory `
      $InstallDirectory `
      $ShapeBackupDirectory
    Restore-ShapeBackup $InstallDirectory $shapeBackup
    Write-Output 'Restored install file/directory shape conflicts'
    exit 0
  }

  $previous = Resolve-ManagedFiles $InstallDirectory (
    Read-InstallManifest $PreviousManifestPath
  )
  $current = Resolve-ManagedFiles $InstallDirectory (
    Read-InstallManifest $CurrentManifestPath
  )
  if ($Mode -eq 'PrepareShape') {
    $shapeBackup = Resolve-ShapeBackupDirectory `
      $InstallDirectory `
      $ShapeBackupDirectory
    Prepare-ShapeConflicts `
      $InstallDirectory `
      $previous `
      $current `
      $shapeBackup
    Write-Output 'Prepared install file/directory shape conflicts'
    exit 0
  }

  $removed = 0
  $missing = 0
  $currentDirectories = Get-ManagedDirectories $current
  foreach ($relativePath in $previous.Keys) {
    if (
      $current.ContainsKey($relativePath) -or
      $currentDirectories.Contains($relativePath)
    ) {
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

  if (![string]::IsNullOrWhiteSpace($ShapeBackupDirectory)) {
    $shapeBackup = Resolve-ShapeBackupDirectory `
      $InstallDirectory `
      $ShapeBackupDirectory
    if (Test-Path -LiteralPath $shapeBackup) {
      Remove-Item -LiteralPath $shapeBackup -Recurse -Force
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
