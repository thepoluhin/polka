; Установщик «Полка» — ставится в профиль пользователя, без прав администратора
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

!define APPNAME "Полка"
!define EXE "Polka.exe"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Polka"
; VERSION и SRC передаются при сборке: -DVERSION=… -DSRC=…

Name "${APPNAME}"
OutFile "..\dist\Polka-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Polka"
InstallDirRegKey HKCU "${REGKEY}" "InstallLocation"
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "Установка «${APPNAME}» — читалки FB2 и EPUB"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" ""

!include "MUI2.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

; Цитаты о книгах — на приветствии, во время установки и в конце; каждый раз три разные
Var Q1
Var A1
Var Q2
Var A2
Var Q3
Var A3
Var QFont
Var QFontBig
!define NQUOTES 7
Function GetQuote ; $0 — номер; цитата в $1, автор в $2
  ${Switch} $0
    ${Case} 0
      StrCpy $1 "«Чтение — вот лучшее учение»"
      StrCpy $2 "— Александр Пушкин"
      ${Break}
    ${Case} 1
      StrCpy $1 "«Я всегда представлял себе рай чем-то вроде библиотеки»"
      StrCpy $2 "— Хорхе Луис Борхес"
      ${Break}
    ${Case} 2
      StrCpy $1 "«Всем хорошим во мне я обязан книгам»"
      StrCpy $2 "— Максим Горький"
      ${Break}
    ${Case} 3
      StrCpy $1 "«Книга — это мечта, которую держишь в руках»"
      StrCpy $2 "— Нил Гейман"
      ${Break}
    ${Case} 4
      StrCpy $1 "«Читатель проживает тысячу жизней, прежде чем умрёт. Тот, кто никогда не читает, проживает только одну»"
      StrCpy $2 "— Джордж Мартин"
      ${Break}
    ${Case} 5
      StrCpy $1 "«Если у тебя есть сад и библиотека, у тебя есть всё, что нужно»"
      StrCpy $2 "— Цицерон"
      ${Break}
    ${Default}
      StrCpy $1 "«Есть преступления хуже, чем сжигать книги. Например — не читать их»"
      StrCpy $2 "— Иосиф Бродский"
      ${Break}
  ${EndSwitch}
FunctionEnd

; шрифты для цитат (Georgia курсив), с учётом масштаба экрана
Function MakeFonts
  StrCmp $QFont "" 0 done
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .r0'
  ${If} $0 < 96
    StrCpy $0 96
  ${EndIf}
  IntOp $1 $0 * 16
  IntOp $1 $1 / 96
  IntOp $1 0 - $1
  System::Call 'gdi32::CreateFontW(i r1, i 0, i 0, i 0, i 400, i 1, i 0, i 0, i 1, i 0, i 0, i 5, i 0, w "Georgia") p .r2'
  StrCpy $QFont $2
  IntOp $1 $0 * 21
  IntOp $1 $1 / 96
  IntOp $1 0 - $1
  System::Call 'gdi32::CreateFontW(i r1, i 0, i 0, i 0, i 400, i 1, i 0, i 0, i 1, i 0, i 0, i 5, i 0, w "Georgia") p .r2'
  StrCpy $QFontBig $2
  done:
FunctionEnd

; $R0 — элемент; положение в окне-родителе: $R5 x, $R6 y, $R7 ширина, $R8 высота
Function CtlRect
  System::Call '*(i,i,i,i) p .r9'
  System::Call 'user32::GetWindowRect(p $R0, p r9)'
  System::Call 'user32::GetParent(p $R0) p .r8'
  System::Call 'user32::MapWindowPoints(p 0, p r8, p r9, i 2)'
  System::Call '*$9(i .R5, i .R6, i .R7, i .R8)'
  IntOp $R7 $R7 - $R5
  IntOp $R8 $R8 - $R6
  System::Free $9
FunctionEnd

; $R0 — элемент со шрифтом, $R1 — текст, $R4 — флаги DrawText; высота текста в $R2
Function TextHeight
  Call CtlRect
  System::Call '*(i 0, i 0, i R7, i 0) p .r6'
  System::Call 'user32::GetDC(p $R0) p .r8'
  SendMessage $R0 ${WM_GETFONT} 0 0 $9
  System::Call 'gdi32::SelectObject(p r8, p r9) p .r7'
  IntOp $5 $R4 | 0x410
  System::Call 'user32::DrawTextW(p r8, w R1, i -1, p r6, i r5)'
  System::Call 'gdi32::SelectObject(p r8, p r7)'
  System::Call 'user32::ReleaseDC(p $R0, p r8)'
  System::Call '*$6(i, i, i, i .R2)'
  System::Free $6
FunctionEnd

; цитата с оранжевой чертой слева: $R0 — подпись цитаты (уже создана, шрифт задан), $R1 — цитата, $R3 — автор
; после: $R9 — нижний край блока (пиксели)
Function QuoteBlock
  StrCpy $R4 0
  Call TextHeight
  Call CtlRect
  System::Call 'user32::SetWindowPos(p $R0, p 0, i 0, i 0, i R7, i R2, i 0x16)'
  IntOp $R6 $R6 + $R2
  IntOp $R6 $R6 + 4
  StrCpy $9 $R5
  ${NSD_CreateLabel} $R5 $R6 $R7 18 "$R3"
  Pop $8
  SetCtlColors $8 "8A7A6A" "FFFFFF"
  IntOp $R9 $R6 + 18
  ; черта
  Call CtlRect
  IntOp $7 $R5 - 12
  IntOp $6 $R2 + 22
  ${NSD_CreateLabel} $7 $R6 3 $6 ""
  Pop $8
  SetCtlColors $8 "" "E8603C"
FunctionEnd

Function .onInit
  ; три разные случайные цитаты: начало и шаг 1–3 (цитат 7 — простое число, номера не повторяются)
  System::Call 'kernel32::GetTickCount()i.r0'
  IntOp $0 $0 & 0x7FFFFFFF
  IntOp $3 $0 / 8
  IntOp $3 $3 % 3
  IntOp $3 $3 + 1
  IntOp $0 $0 % ${NQUOTES}
  Call GetQuote
  StrCpy $Q1 $1
  StrCpy $A1 $2
  IntOp $0 $0 + $3
  IntOp $0 $0 % ${NQUOTES}
  Call GetQuote
  StrCpy $Q2 $1
  StrCpy $A2 $2
  IntOp $0 $0 + $3
  IntOp $0 $0 % ${NQUOTES}
  Call GetQuote
  StrCpy $Q3 $1
  StrCpy $A3 $2
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "«Полке» нужна 64-битная Windows."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "«Полке» нужна Windows 10 или новее."
    Abort
  ${EndIf}
FunctionEnd
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEFINISHPAGE_BITMAP "installer-side.bmp"
ShowInstDetails nevershow
!define MUI_WELCOMEPAGE_TITLE "Установка «Полки»"
!define MUI_WELCOMEPAGE_TEXT "Домашняя читалка FB2 и EPUB.$\r$\n$\r$\nПрограмма будет установлена для вашей учётной записи, права администратора не нужны. Ваша библиотека, место чтения, закладки и заметки сохранятся."
!define MUI_FINISHPAGE_TITLE "«Полка» готова"
!define MUI_FINISHPAGE_TEXT "Программа установлена. Приятного чтения!"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить «Полку»"

!define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomeShow
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_HEADER_TEXT "Ставлю «Полку» на место"
!define MUI_PAGE_HEADER_SUBTEXT "Несколько секунд — и можно читать."
!define MUI_PAGE_CUSTOMFUNCTION_SHOW InstShow
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishShow
!insertmacro MUI_PAGE_FINISH
!define MUI_UNCONFIRMPAGE_TEXT_TOP "«Полка» будет полностью удалена с компьютера вместе с её данными: библиотекой, местом чтения, закладками, цитатами и заметками в программе.$\r$\nПапка «Читательский дневник» и сами книги не удаляются."
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

Function WelcomeShow
  ; на странице приветствия кнопка «Далее» сразу называется «Установить»
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Установить"
  Call MakeFonts
  ; ниже текста приветствия — цитата
  ${NSD_CreateLabel} 132u 108u 183u 60u "$Q1"
  Pop $R0
  SetCtlColors $R0 "5A4636" "FFFFFF"
  SendMessage $R0 ${WM_SETFONT} $QFont 1
  Call CtlRect
  StrCpy $4 $R6
  Push $R0
  StrCpy $R0 $mui.WelcomePage.Text
  Call CtlRect
  IntOp $4 $4 - $R6
  IntOp $4 $4 - 8
  System::Call 'user32::SetWindowPos(p $R0, p 0, i 0, i 0, i R7, i r4, i 0x16)'
  Pop $R0
  StrCpy $R1 $Q1
  StrCpy $R3 $A1
  Call QuoteBlock
FunctionEnd

; во время установки: вместо списка файлов — крупная цитата по центру
Function InstShow
  Call MakeFonts
  FindWindow $R9 "#32770" "" $HWNDPARENT
  GetDlgItem $R0 $R9 1016
  Call CtlRect
  IntOp $R6 $R6 + 26
  StrCpy $R1 $Q2
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w R1, i 0x50000001, i R5, i R6, i R7, i 60, p R9, p 0, p 0, p 0) p .R0'
  SendMessage $R0 ${WM_SETFONT} $QFontBig 1
  SetCtlColors $R0 "4A3A2C" "transparent"
  StrCpy $R1 $Q2
  StrCpy $R4 1
  Call TextHeight
  System::Call 'user32::SetWindowPos(p $R0, p 0, i 0, i 0, i R7, i R2, i 0x16)'
  IntOp $R6 $R6 + $R2
  IntOp $R6 $R6 + 10
  StrCpy $R3 $A2
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w R3, i 0x50000001, i R5, i R6, i R7, i 20, p R9, p 0, p 0, p 0) p .R1'
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $0
  SendMessage $R1 ${WM_SETFONT} $0 1
  SetCtlColors $R1 "8A7A6A" "transparent"
FunctionEnd

; конец: строка «установлена», цитата, ниже — «Запустить»
Function FinishShow
  Call MakeFonts
  ${NSD_CreateLabel} 132u 64u 183u 60u "$Q3"
  Pop $R0
  SetCtlColors $R0 "5A4636" "FFFFFF"
  SendMessage $R0 ${WM_SETFONT} $QFont 1
  Call CtlRect
  StrCpy $4 $R6
  Push $R0
  StrCpy $R0 $mui.FinishPage.Text
  Call CtlRect
  IntOp $4 $4 - $R6
  IntOp $4 $4 - 8
  System::Call 'user32::SetWindowPos(p $R0, p 0, i 0, i 0, i R7, i r4, i 0x16)'
  Pop $R0
  StrCpy $R1 $Q3
  StrCpy $R3 $A3
  Call QuoteBlock
  ; «Запустить» — под цитатой
  StrCpy $R0 $mui.FinishPage.Run
  Call CtlRect
  IntOp $R9 $R9 + 18
  System::Call 'user32::SetWindowPos(p $R0, p 0, i R5, i R9, i 0, i 0, i 0x15)'
FunctionEnd

; закрыть запущенную «Полку» штатно (она успеет сохранить место чтения); принудительно — только если не закрылась за 10 с
!macro CLOSE_POLKA UN
Function ${UN}ClosePolka
  nsExec::Exec 'taskkill /IM ${EXE}'
  StrCpy $1 0
  wait_${UN}:
    nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ${EXE}" /NH | find /I "${EXE}"'
    Pop $0
    Pop $2
    StrCmp $0 "0" 0 gone_${UN}
    IntOp $1 $1 + 1
    IntCmp $1 20 force_${UN} 0 force_${UN}
    Sleep 500
    Goto wait_${UN}
  force_${UN}:
    nsExec::Exec 'taskkill /F /IM ${EXE}'
    Sleep 1000
  gone_${UN}:
FunctionEnd
!macroend
!insertmacro CLOSE_POLKA ""
!insertmacro CLOSE_POLKA "un."

Section "Install"
  Call ClosePolka
  ; от прошлой версии не должно остаться ни одного файла (переименованные и удалённые в новой версии
  ; библиотеки, языки, старый «Как запустить.txt»…): папку программы очищаем целиком.
  ; Данных пользователя в ней нет — они в %APPDATA%\Полка и рядом с книгами.
  ; Очищаем, только если это действительно папка «Полки» (в ней лежит Polka.exe).
  IfFileExists "$INSTDIR\${EXE}" 0 +2
    RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; ярлыки
  CreateShortCut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  ; «Приложения и возможности» Windows
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${REGKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" 260000

  ; книги: «Открыть с помощью → Полка» для .fb2 и .epub (чужие настройки не перебиваем)
  WriteRegStr HKCU "Software\Classes\Polka.Book" "" "Книга"
  WriteRegStr HKCU "Software\Classes\Polka.Book\DefaultIcon" "" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "Software\Classes\Polka.Book\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\.fb2\OpenWithProgids" "Polka.Book" ""
  WriteRegStr HKCU "Software\Classes\.epub\OpenWithProgids" "Polka.Book" ""
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}" "FriendlyAppName" "${APPNAME}"
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}\SupportedTypes" ".fb2" ""
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}\SupportedTypes" ".epub" ""
  ; если у .fb2 ещё нет программы по умолчанию — пусть будет Полка
  ; (HKCR — с учётом программ, установленных для всех пользователей: их не перебиваем)
  ReadRegStr $0 HKCR ".fb2" ""
  StrCmp $0 "" 0 +2
    WriteRegStr HKCU "Software\Classes\.fb2" "" "Polka.Book"

  ; ссылки polka:// из файлов дневника
  WriteRegStr HKCU "Software\Classes\polka" "" "URL:Polka"
  WriteRegStr HKCU "Software\Classes\polka" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\polka\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

; убрать следы «Полки» у одного типа файлов (.fb2 / .epub), не трогая чужое
Function un.CleanExt
  ; $R0 = расширение с точкой
  DeleteRegValue HKCU "Software\Classes\$R0\OpenWithProgids" "Polka.Book"
  ReadRegStr $0 HKCU "Software\Classes\$R0" ""
  StrCmp $0 "Polka.Book" 0 +2
    DeleteRegValue HKCU "Software\Classes\$R0" ""
  DeleteRegKey /ifempty HKCU "Software\Classes\$R0\OpenWithProgids"
  DeleteRegKey /ifempty HKCU "Software\Classes\$R0"
  ; записи проводника «открывали с помощью…» — только указывающие на Polka.exe
  StrCpy $R1 "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$R0"
  StrCpy $1 0
  loop:
    EnumRegValue $2 HKCU "$R1\OpenWithList" $1
    StrCmp $2 "" done
    ReadRegStr $3 HKCU "$R1\OpenWithList" $2
    StrCmp $3 "${EXE}" 0 next
      DeleteRegValue HKCU "$R1\OpenWithList" $2
      Goto loop
    next:
    IntOp $1 $1 + 1
    Goto loop
  done:
  DeleteRegValue HKCU "$R1\OpenWithProgids" "Polka.Book"
  ReadRegStr $0 HKCU "$R1\UserChoice" "ProgId"
  StrCmp $0 "Polka.Book" +2 0
  StrCmp $0 "Applications\${EXE}" 0 +2
    DeleteRegKey HKCU "$R1\UserChoice"
  ReadRegStr $0 HKCU "$R1\UserChoiceLatest\ProgId" "ProgId"
  StrCmp $0 "Polka.Book" +2 0
  StrCmp $0 "Applications\${EXE}" 0 +2
    DeleteRegKey HKCU "$R1\UserChoiceLatest"
  DeleteRegKey /ifempty HKCU "$R1\OpenWithProgids"
  DeleteRegKey /ifempty HKCU "$R1\OpenWithList"
  DeleteRegKey /ifempty HKCU "$R1"
FunctionEnd

Section "Uninstall"
  Call un.ClosePolka
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\Classes\Polka.Book"
  DeleteRegKey HKCU "Software\Classes\Applications\${EXE}"
  DeleteRegKey HKCU "Software\Classes\polka"
  ; выбор «чем открывать ссылки polka://», если Windows его запомнила (протокол — только наш)
  DeleteRegKey HKCU "Software\Microsoft\Windows\Shell\Associations\UrlAssociations\polka"
  StrCpy $R0 ".fb2"
  Call un.CleanExt
  StrCpy $R0 ".epub"
  Call un.CleanExt
  ; .fb2.zip для Windows — это .zip: «Полку» могли выбрать для него вручную («Открыть с помощью»)
  StrCpy $R0 ".zip"
  Call un.CleanExt
  ; что Windows сама запомнила о программе: имя для «Открыть с помощью»
  ; и отметки «новое приложение для этого типа файлов»
  DeleteRegValue HKCU "Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache" "$INSTDIR\${EXE}.FriendlyAppName"
  DeleteRegValue HKCU "Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache" "$INSTDIR\${EXE}.ApplicationCompany"
  StrCpy $R1 "Software\Microsoft\Windows\CurrentVersion\ApplicationAssociationToasts"
  DeleteRegValue HKCU $R1 "Polka.Book_.fb2"
  DeleteRegValue HKCU $R1 "Polka.Book_.epub"
  DeleteRegValue HKCU $R1 "Applications\${EXE}_.fb2"
  DeleteRegValue HKCU $R1 "Applications\${EXE}_.epub"
  DeleteRegValue HKCU $R1 "Applications\${EXE}_.zip"
  DeleteRegValue HKCU $R1 "polka_polka"
  ; данные программы (кэши, библиотека, место чтения, закладки, цитаты)
  RMDir /r "$APPDATA\${APPNAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

