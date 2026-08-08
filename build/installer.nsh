; AutoWSGR-GUI NSIS 自定义安装脚本
; 安装 VC++ Redistributable，并让新版 GUI 首次启动时更新指定后端。

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
