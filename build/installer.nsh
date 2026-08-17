; AutoWSGR-GUI NSIS 自定义安装脚本
; 安装 VC++ Redistributable，并让新版 GUI 首次启动时更新指定后端。

!define INSTALL_MANIFEST "$INSTDIR\resources\.autowsgr-install-manifest.json"
!define PREVIOUS_INSTALL_MANIFEST "$INSTDIR\resources\.autowsgr-previous-install-manifest.json"
!define LEGACY_SITE_PACKAGES_BACKUP "$INSTDIR.site-packages-update"
!define LEGACY_LOG_BACKUP "$INSTDIR.autowsgr-log-update"
!define LEGACY_LOGS_BACKUP "$INSTDIR.autowsgr-logs-update"

; 只结束安装目录内置 adb.exe，避免影响系统或其他工具的 ADB。
!macro StopBundledAdb LABEL_SUFFIX
  IfFileExists "$INSTDIR\adb\adb.exe" 0 BundledAdbStopped_${LABEL_SUFFIX}
    DetailPrint "正在停止旧版内置 ADB server..."
    nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$target=[IO.Path]::GetFullPath($$args[0]); Get-Process -Name adb -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and [IO.Path]::GetFullPath($$_.Path) -eq $$target } | Stop-Process -Force" "$INSTDIR\adb\adb.exe"'
    Pop $R2
  BundledAdbStopped_${LABEL_SUFFIX}:
!macroend

!macro PreserveLegacyDirectory SOURCE BACKUP LABEL_SUFFIX FAILURE_LABEL
  IfFileExists "${BACKUP}\*.*" LegacyDirectoryPreserved_${LABEL_SUFFIX} 0
  IfFileExists "${SOURCE}\*.*" 0 LegacyDirectoryPreserved_${LABEL_SUFFIX}
  ClearErrors
  Rename "${SOURCE}" "${BACKUP}"
  IfErrors ${FAILURE_LABEL} LegacyDirectoryPreserved_${LABEL_SUFFIX}
  LegacyDirectoryPreserved_${LABEL_SUFFIX}:
!macroend

!macro RestoreLegacyDirectory BACKUP DESTINATION PARENT LABEL_SUFFIX FAILURE_LABEL
  IfFileExists "${BACKUP}\*.*" 0 LegacyDirectoryRestored_${LABEL_SUFFIX}
  CreateDirectory "${PARENT}"
  ClearErrors
  Rename "${BACKUP}" "${DESTINATION}"
  IfErrors ${FAILURE_LABEL} LegacyDirectoryRestored_${LABEL_SUFFIX}
  LegacyDirectoryRestored_${LABEL_SUFFIX}:
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

  ${If} $R4 == "1"
    ${If} $R5 == "1"
      ; 保留失败更新留下的旧清单，使同版本重试仍能完成差集清理。
      IfFileExists "${PREVIOUS_INSTALL_MANIFEST}" InstallManifestStaged 0
      CreateDirectory "$INSTDIR\resources"
      ClearErrors
      CopyFiles /SILENT \
        "${INSTALL_MANIFEST}" \
        "${PREVIOUS_INSTALL_MANIFEST}"
      IfErrors InstallManifestStageFailed InstallManifestStaged
    ${EndIf}

    ; 首次从无清单旧版升级时，只迁移明确的持久数据目录。
    !insertmacro PreserveLegacyDirectory \
      "$INSTDIR\python\site-packages" \
      "${LEGACY_SITE_PACKAGES_BACKUP}" \
      SitePackages \
      LegacyDataPreserveFailed
    !insertmacro PreserveLegacyDirectory \
      "$INSTDIR\log" \
      "${LEGACY_LOG_BACKUP}" \
      Log \
      LegacyDataPreserveFailed
    !insertmacro PreserveLegacyDirectory \
      "$INSTDIR\logs" \
      "${LEGACY_LOGS_BACKUP}" \
      Logs \
      LegacyDataPreserveFailed
    DetailPrint "已临时保留旧版日志和后端依赖"
    Goto InstallManifestStaged

    InstallManifestStageFailed:
      Delete "${PREVIOUS_INSTALL_MANIFEST}"
      MessageBox MB_OK|MB_ICONSTOP \
        "无法保存旧版程序文件清单，安装已停止，旧版本未被修改。"
      SetErrorLevel 1
      Quit

    LegacyDataPreserveFailed:
      !insertmacro RestoreLegacyDirectory \
        "${LEGACY_SITE_PACKAGES_BACKUP}" \
        "$INSTDIR\python\site-packages" \
        "$INSTDIR\python" \
        RollbackSitePackages \
        LegacyDataRollbackFailed
      !insertmacro RestoreLegacyDirectory \
        "${LEGACY_LOG_BACKUP}" \
        "$INSTDIR\log" \
        "$INSTDIR" \
        RollbackLog \
        LegacyDataRollbackFailed
      !insertmacro RestoreLegacyDirectory \
        "${LEGACY_LOGS_BACKUP}" \
        "$INSTDIR\logs" \
        "$INSTDIR" \
        RollbackLogs \
        LegacyDataRollbackFailed
      MessageBox MB_OK|MB_ICONSTOP \
        "无法临时保留旧版日志或后端依赖，安装已停止，旧版本未被修改。"
      SetErrorLevel 1
      Quit

    LegacyDataRollbackFailed:
      MessageBox MB_OK|MB_ICONSTOP \
        "旧版数据恢复失败，安装已停止。临时数据仍保留在安装目录旁。"
      SetErrorLevel 1
      Quit

    InstallManifestStaged:
      DetailPrint "已准备程序文件所有权清单"
  ${EndIf}
!macroend

; 覆盖升级保留安装目录；只有主动卸载才完整清理。
!macro customRemoveFiles
  ${ifNot} ${isUpdated}
    RMDir /r "$INSTDIR"
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "${LEGACY_SITE_PACKAGES_BACKUP}"
    RMDir /r "${LEGACY_LOG_BACKUP}"
    RMDir /r "${LEGACY_LOGS_BACKUP}"
  ${endIf}
!macroend

!macro customInstall
  ${If} ${isUpdated}
  ${OrIf} ${FileExists} "${PREVIOUS_INSTALL_MANIFEST}"
    ${If} ${FileExists} "$newDesktopLink"
      !insertmacro addDesktopLink "false"
    ${EndIf}
    ${If} ${FileExists} "$newStartMenuLink"
      !insertmacro addStartMenuLink "false"
    ${EndIf}
  ${EndIf}

  ; 新包落盘后，只删除旧清单拥有而新清单不再拥有的文件。
  IfFileExists "${PREVIOUS_INSTALL_MANIFEST}" 0 ManagedFileCleanupSkipped
  IfFileExists "${INSTALL_MANIFEST}" 0 ManagedFileCleanupFailed
    InitPluginsDir
    File /oname=$PLUGINSDIR\remove-managed-install-files.ps1 \
      "${PROJECT_DIR}\build\remove-managed-install-files.ps1"
    nsExec::ExecToLog \
      '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\remove-managed-install-files.ps1" -InstallDirectory "$INSTDIR" -PreviousManifestPath "${PREVIOUS_INSTALL_MANIFEST}" -CurrentManifestPath "${INSTALL_MANIFEST}"'
    Pop $R0
    StrCmp $R0 "0" ManagedFileCleanupDone ManagedFileCleanupFailed

    ManagedFileCleanupFailed:
      DetailPrint "下架程序文件清理失败，安装已停止"
      MessageBox MB_OK|MB_ICONSTOP \
        "无法安全清理下架程序文件。安装已停止，清单外文件未被处理。"
      SetErrorLevel 1
      Quit

    ManagedFileCleanupDone:
      Delete "${PREVIOUS_INSTALL_MANIFEST}"
      DetailPrint "已清理下架程序文件"

  ManagedFileCleanupSkipped:
  ; 首次旧版升级完成后恢复日志和后端依赖。
  !insertmacro RestoreLegacyDirectory \
    "${LEGACY_SITE_PACKAGES_BACKUP}" \
    "$INSTDIR\python\site-packages" \
    "$INSTDIR\python" \
    InstallSitePackages \
    LegacyDataRestoreFailed
  !insertmacro RestoreLegacyDirectory \
    "${LEGACY_LOG_BACKUP}" \
    "$INSTDIR\log" \
    "$INSTDIR" \
    InstallLog \
    LegacyDataRestoreFailed
  !insertmacro RestoreLegacyDirectory \
    "${LEGACY_LOGS_BACKUP}" \
    "$INSTDIR\logs" \
    "$INSTDIR" \
    InstallLogs \
    LegacyDataRestoreFailed
  Goto LegacyDataRestored

  LegacyDataRestoreFailed:
    MessageBox MB_OK|MB_ICONSTOP \
      "旧版日志或后端依赖恢复失败，安装已停止。临时数据仍保留在安装目录旁。"
    SetErrorLevel 1
    Quit

  LegacyDataRestored:
  IfFileExists "$SYSDIR\vcruntime140.dll" VCRedistInstalled 0
    DetailPrint "正在安装 Microsoft Visual C++ Redistributable..."
    nsExec::ExecToLog '"$INSTDIR\redist\vc_redist.x64.exe" /install /quiet /norestart'
    Pop $0
    DetailPrint "VC++ Redistributable 安装完成 (exit code: $0)"
  VCRedistInstalled:

  Delete "$INSTDIR\.env_ready"
  DetailPrint "已安排首次启动时更新本包指定的 AutoWSGR 后端"
!macroend
