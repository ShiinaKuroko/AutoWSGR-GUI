; AutoWSGR-GUI NSIS 自定义安装脚本
; 安装 VC++ Redistributable，并让新版 GUI 首次启动时更新指定后端。

!define INSTALL_MANIFEST "$INSTDIR\resources\.autowsgr-install-manifest.json"
!define PREVIOUS_INSTALL_MANIFEST "$INSTDIR\resources\.autowsgr-previous-install-manifest.json"
!define NEXT_INSTALL_MANIFEST "$INSTDIR\resources\.autowsgr-next-install-manifest.json"
!define MANAGED_FILE_BACKUP "$INSTDIR.autowsgr-update-backup"

; 只结束安装目录内置 adb.exe，避免影响系统或其他工具的 ADB。
!macro StopBundledAdb LABEL_SUFFIX
  IfFileExists "$INSTDIR\adb\adb.exe" 0 BundledAdbStopped_${LABEL_SUFFIX}
    DetailPrint "正在停止旧版内置 ADB server..."
    nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$target=[IO.Path]::GetFullPath($$args[0]); Get-Process -Name adb -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and [IO.Path]::GetFullPath($$_.Path) -eq $$target } | Stop-Process -Force" "$INSTDIR\adb\adb.exe"'
    Pop $R2
  BundledAdbStopped_${LABEL_SUFFIX}:
!macroend

; 覆盖安装时先等待 GUI 正常停止后端，超时后再结束整棵进程树。
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE

  RetryCloseApp:
  !insertmacro StopBundledAdb Initial

  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    DetailPrint "正在关闭旧版 AutoWSGR-GUI..."
    nsExec::Exec '"$SYSDIR\taskkill.exe" /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $R2
    StrCpy $R1 0

    WaitForGracefulExit:
    Sleep 1000
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 != 0
      Goto AppClosed
    ${EndIf}
    IntOp $R1 $R1 + 1
    ${If} $R1 < 20
      Goto WaitForGracefulExit
    ${EndIf}

    DetailPrint "正常退出超时，正在结束 AutoWSGR-GUI 及其子进程..."
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $R2
    !insertmacro StopBundledAdb Forced

    Sleep 2000
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
        "AutoWSGR-GUI 无法自动关闭。请用管理员权限关闭它，然后单击重试。" \
        IDRETRY RetryCloseApp
      Quit
    ${EndIf}
  ${EndIf}

  AppClosed:
  StrCpy $R4 "0"
  ${If} ${isUpdated}
    StrCpy $R4 "1"
  ${ElseIf} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
    StrCpy $R4 "1"
  ${EndIf}
  StrCpy $R5 "0"
  ${If} ${FileExists} "${INSTALL_MANIFEST}"
    StrCpy $R5 "1"
  ${EndIf}

  ; 新安装器先留下双清单，兼容版旧卸载器只校验，不提前删除程序文件。
  ${If} $R4 == "1"
    InitPluginsDir
    File /oname=$PLUGINSDIR\autowsgr-next-install-manifest.json \
      "${PROJECT_DIR}\build\generated\install-manifest.json"
    CreateDirectory "$INSTDIR\resources"
    Delete "${PREVIOUS_INSTALL_MANIFEST}"
    Delete "${NEXT_INSTALL_MANIFEST}"
    ${If} $R5 == "1"
      ClearErrors
      CopyFiles /SILENT \
        "${INSTALL_MANIFEST}" \
        "${PREVIOUS_INSTALL_MANIFEST}"
      IfErrors InstallManifestStageFailed 0
    ${EndIf}
    ClearErrors
    CopyFiles /SILENT \
      "$PLUGINSDIR\autowsgr-next-install-manifest.json" \
      "${NEXT_INSTALL_MANIFEST}"
    IfErrors InstallManifestStageFailed InstallManifestStaged

    InstallManifestStageFailed:
      Delete "${PREVIOUS_INSTALL_MANIFEST}"
      Delete "${NEXT_INSTALL_MANIFEST}"
      MessageBox MB_OK|MB_ICONSTOP \
        "无法准备新版程序文件清单，安装已停止，旧版本未被修改。"
      SetErrorLevel 1
      Quit

    InstallManifestStaged:
      DetailPrint "已准备新版程序文件清单"
  ${EndIf}

  ; 首次从旧版过渡时临时移出后端依赖；后续清单升级不再搬移。
  ${If} $R4 == "1"
    ${If} $R5 == "1"
      Goto BackendEnvPreserved
    ${EndIf}
    IfFileExists "$INSTDIR.site-packages-update\*.*" BackendEnvPreserved 0
    IfFileExists "$INSTDIR\python\site-packages\*.*" 0 BackendEnvPreserved
    ClearErrors
    Rename "$INSTDIR\python\site-packages" "$INSTDIR.site-packages-update"
    IfErrors BackendEnvPreserveFailed BackendEnvPreserveDone

    BackendEnvPreserveFailed:
      DetailPrint "后端依赖临时保留失败，将使用完整覆盖安装"
      Goto BackendEnvPreserved

    BackendEnvPreserveDone:
      DetailPrint "已临时保留后端依赖"
  ${EndIf}

  BackendEnvPreserved:
!macroend

; 覆盖升级会调用旧卸载器，此时保留依赖；只有主动卸载才完整清理。
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$INSTDIR\python\site-packages"
    RMDir /r "$INSTDIR.site-packages-update"
  ${endIf}
!macroend

; 兼容版之后的旧卸载器只验证双清单，新包落盘后再清理下架文件。
!macro customRemoveFiles
  ${If} ${isUpdated}
    IfFileExists "${INSTALL_MANIFEST}" 0 ManagedFileCleanupFailed
    IfFileExists "${NEXT_INSTALL_MANIFEST}" 0 ManagedFileCleanupFailed
    InitPluginsDir
    File /oname=$PLUGINSDIR\remove-managed-install-files.ps1 \
      "${PROJECT_DIR}\build\remove-managed-install-files.ps1"
    nsExec::ExecToLog \
      '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\remove-managed-install-files.ps1" -InstallDirectory "$INSTDIR" -CurrentManifestPath "${INSTALL_MANIFEST}" -NextManifestPath "${NEXT_INSTALL_MANIFEST}" -Mode Validate'
    Pop $R0
    StrCmp $R0 "0" ManagedFileCleanupDone ManagedFileCleanupFailed

    ManagedFileCleanupFailed:
      DetailPrint "程序文件清单校验失败，安装已停止"
      MessageBox MB_OK|MB_ICONSTOP \
        "无法安全校验程序文件清单。安装已停止，旧版本未被修改。"
      SetErrorLevel 1
      Quit

    ManagedFileCleanupDone:
      DetailPrint "程序文件清单校验通过，等待新版文件落盘"
  ${Else}
    RMDir /r "$INSTDIR"
  ${EndIf}
!macroend

!macro customInstall
  ${If} ${isUpdated}
  ${OrIf} ${FileExists} "${NEXT_INSTALL_MANIFEST}"
    ${If} ${FileExists} "$newDesktopLink"
      !insertmacro addDesktopLink "false"
    ${EndIf}
    ${If} ${FileExists} "$newStartMenuLink"
      !insertmacro addStartMenuLink "false"
    ${EndIf}
  ${EndIf}

  ; 新包完整落盘后校验哈希并事务清理下架文件。
  IfFileExists "${PREVIOUS_INSTALL_MANIFEST}" 0 ManagedFileFinalizeSkipped
  IfFileExists "${NEXT_INSTALL_MANIFEST}" 0 ManagedFileFinalizeFailed
    InitPluginsDir
    File /oname=$PLUGINSDIR\remove-managed-install-files.ps1 \
      "${PROJECT_DIR}\build\remove-managed-install-files.ps1"
    nsExec::ExecToLog \
      '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\remove-managed-install-files.ps1" -InstallDirectory "$INSTDIR" -CurrentManifestPath "${PREVIOUS_INSTALL_MANIFEST}" -NextManifestPath "${INSTALL_MANIFEST}" -Mode Finalize -BackupDirectory "${MANAGED_FILE_BACKUP}"'
    Pop $R0
    StrCmp $R0 "0" ManagedFileFinalizeDone ManagedFileFinalizeFailed

    ManagedFileFinalizeFailed:
      DetailPrint "程序文件增量收尾失败，安装已停止"
      MessageBox MB_OK|MB_ICONSTOP \
        "新版程序文件校验或旧文件清理失败。安装已停止，未知文件未被处理。"
      SetErrorLevel 1
      Quit

    ManagedFileFinalizeDone:
      RMDir /r "${MANAGED_FILE_BACKUP}"
      DetailPrint "已校验新版文件并清理下架程序文件"

  ManagedFileFinalizeSkipped:
  ; 新前端写入完成后恢复依赖，后端版本仍由首次启动检查更新。
  IfFileExists "$INSTDIR.site-packages-update\*.*" 0 BackendEnvRestored
    CreateDirectory "$INSTDIR\python"
    ClearErrors
    Rename "$INSTDIR.site-packages-update" "$INSTDIR\python\site-packages"
    IfErrors BackendEnvRestoreFailed BackendEnvRestoreDone

    BackendEnvRestoreFailed:
      DetailPrint "后端依赖恢复失败，首次启动时将重新安装"
      Goto BackendEnvRestored

    BackendEnvRestoreDone:
      DetailPrint "已恢复后端依赖"

  BackendEnvRestored:
  Delete "${PREVIOUS_INSTALL_MANIFEST}"
  Delete "${NEXT_INSTALL_MANIFEST}"
  IfFileExists "$SYSDIR\vcruntime140.dll" VCRedistInstalled 0
    DetailPrint "正在安装 Microsoft Visual C++ Redistributable..."
    nsExec::ExecToLog '"$INSTDIR\redist\vc_redist.x64.exe" /install /quiet /norestart'
    Pop $0
    DetailPrint "VC++ Redistributable 安装完成 (exit code: $0)"
  VCRedistInstalled:

  Delete "$INSTDIR\.env_ready"
  DetailPrint "已安排首次启动时更新本包指定的 AutoWSGR 后端"
!macroend
