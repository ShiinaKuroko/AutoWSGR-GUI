; AutoWSGR-GUI NSIS 自定义安装脚本
; 安装 VC++ Redistributable，并让新版 GUI 首次启动时更新指定后端。

; 覆盖安装时先等待 GUI 正常停止后端，超时后再结束整棵进程树。
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE

  RetryCloseApp:
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
!macroend

!macro customInstall
  IfFileExists "$SYSDIR\vcruntime140.dll" VCRedistInstalled 0
    DetailPrint "正在安装 Microsoft Visual C++ Redistributable..."
    nsExec::ExecToLog '"$INSTDIR\redist\vc_redist.x64.exe" /install /quiet /norestart'
    Pop $0
    DetailPrint "VC++ Redistributable 安装完成 (exit code: $0)"
  VCRedistInstalled:

  Delete "$INSTDIR\.env_ready"
  DetailPrint "已安排首次启动时更新本包指定的 AutoWSGR 后端"
!macroend
