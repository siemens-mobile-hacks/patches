### Patches with errors
[C81v51/10629-swilib_c81v51_vkp.vkp](https://patches.kibab.com/patches/details.php5?id=10629)

Warning: Useless "#pragma enable old_equal_ff" has no effect at line 1057 col 1
You can safely remove this line.
```
  1054 | ;F44:              ; 3D1: void MediaProc_LaunchLastPlayback()
  1055 | ;F48:              ; 3D2: int GetScreenSaverType()
  1056 | 0F4C: 0xA090E36B   ; 3D3: void IllumFilterSet(int flags, int unk)
> 1057 | #pragma enable old_equal_ff
       | ^
  1058 | +0
  1059 | 
  1060 | ;------------------------- end -------------------------

```

Warning: Uncanceled pragma "old_equal_ff" at line 14 col 1
Please put "#pragma disable old_equal_ff" at the end of the patch.
```
    11 | 
    12 | ; C81v51
    13 | +00074000
>   14 | #pragma enable old_equal_ff
       | ^
    15 | 
    16 | 0000: 0xA0002070   ;   0: void loopback0()
    17 | 0004: 0xA0002070   ;   1: void loopback1()

```

[C81v51/10951-BS_SM_White_C81sw51.vkp](https://patches.kibab.com/patches/details.php5?id=10951)

Warning: Uncanceled offset +01D40204 at line 32 col 1
Please put "+0" at the end of the patch.
```
    29 | 00000040: 06F8D9FC2CFBDFFF52AD
    30 | 
    31 | ; Картинка
>   32 | +01D40204
       | ^
    33 | 00000000: 00000000000000000000000000000000
    34 | 00000010: 00000000000000000000000000000000
    35 | 00000020: 00000000000000000000000000000000

```


### Additional files are not found
The patch has additional files, but it isn't accessible.

| ID | Model | PATCH |
|---|---|---|
| 9067 | A52v9 | [Увеличение максимального размера мелодий с 3400 до 5350-16380 байт<br>Increase melodies maximum size from 3400 to 5300-16380 bytes](https://patches.kibab.com/patches/details.php5?id=9067) |
| 2058 | C75v22 | [Смайлы<br>Smail's](https://patches.kibab.com/patches/details.php5?id=2058) |
| 10215 | C81v51 | [ELFPack 3.0 by Z.Vova & Ganster<br>ELFPack 3.0 by Z.Vova & Ganster](https://patches.kibab.com/patches/details.php5?id=10215) |
| 10421 | C81v51 | [Переключение оконного/полноэкранного видео на лету<br>Switch video fullscreen and normal mode on the fly](https://patches.kibab.com/patches/details.php5?id=10421) |
| 10434 | C81v51 | [Запись телефонных разговоров<br>Call Recorder](https://patches.kibab.com/patches/details.php5?id=10434) |
| 7223 | C81v51 | [Библиотека функций<br>Functions Library](https://patches.kibab.com/patches/details.php5?id=7223) |
| 10258 | CF75v23 | [Загрузчик эльфов 3.0 Z.Vova, Ganster<br>ELFLoader 3.0 Z.Vova, Ganster](https://patches.kibab.com/patches/details.php5?id=10258) |
| 10396 | CL61v128 | [Elfloader 2.3 Official<br>Elfloader 2.3 Official](https://patches.kibab.com/patches/details.php5?id=10396) |
| 3737 | CX65v43 | [ZIPViewer<br>ZIPViewer](https://patches.kibab.com/patches/details.php5?id=3737) |
| 3059 | SL45iv56 | [DLDR. Загрузчик демонов (READRESSED)<br>DLDR. Daemon loader (READRESSED)](https://patches.kibab.com/patches/details.php5?id=3059) |
| 3403 | X75v100 | [Иконка вибры<br>Vibra Icon](https://patches.kibab.com/patches/details.php5?id=3403) |
| 3404 | X75v100 | [Зеленый Калькулятор<br>Green Calculator](https://patches.kibab.com/patches/details.php5?id=3404) |
| 4039 | X75v100 | [Иконки картинок<br>Pictures icons](https://patches.kibab.com/patches/details.php5?id=4039) |
| 4059 | X75v100 | [Иконки плейлиста<br>Playlist icon](https://patches.kibab.com/patches/details.php5?id=4059) |
| 4079 | X75v100 | [Иконки картинок<br>Pictures icons](https://patches.kibab.com/patches/details.php5?id=4079) |
| 6777 | X75v100 | [Папки в экплорере<br>Folders in explorer](https://patches.kibab.com/patches/details.php5?id=6777) |
### The patch is in the archive instead of a patch body
This is not always an error, some patches are too big.

| ID | Model | PATCH |
|---|---|---|
| 2691 | A50v12 | [Relocation<br>Relocation](https://patches.kibab.com/patches/details.php5?id=2691) |
| 226 | C55v24 | [Распакованная графика<br>Unpacked graph](https://patches.kibab.com/patches/details.php5?id=226) |
| 3127 | SL45iv56 | [Изменить вид софтов без функции<br>Modify the picture of the softkey having no function](https://patches.kibab.com/patches/details.php5?id=3127) |
| 5911 | SL45iv56 | [zLogReader<br>zLogReader](https://patches.kibab.com/patches/details.php5?id=5911) |
| 6961 | SL65v53 | [ELFpack<br>ELFpack](https://patches.kibab.com/patches/details.php5?id=6961) |
### Empty patches
This is not always an error, some patches contain commented lines.

| ID | Model | PATCH |
|---|---|---|
| 2193 | A50v12 | [Динамическая вибра без выбора из меню<br>Dynamic vibra without the selection from the menu](https://patches.kibab.com/patches/details.php5?id=2193) |
| 102 | CX70v50 | [Изменить позицию и шрифт имени провайдера в заставке<br>Change position and font of providername in ScreenSaver](https://patches.kibab.com/patches/details.php5?id=102) |
| 107 | CX70v50 | [Изменить папку для фотографий<br>Change folder for photos](https://patches.kibab.com/patches/details.php5?id=107) |
| 7066 | CX70v56 | [Изменениe надписи "Эта SIM"<br>Edit message "This SIM"](https://patches.kibab.com/patches/details.php5?id=7066) |
| 3383 | CX75v13 | [Изменение модели телефона в *#06#<br>Rename phone's model in *#06#](https://patches.kibab.com/patches/details.php5?id=3383) |
| 6097 | CX75v13 | [Увеличение интервала между сообщениями "Аккумулятор разряжен! Зарядите"<br>An increase in the interval between the communications "Storage battery is discharged! You will load"](https://patches.kibab.com/patches/details.php5?id=6097) |
| 8536 | E71v45 | [Своя структура подменю в моих файлах<br>Own structure of sub-menu in card-explorer](https://patches.kibab.com/patches/details.php5?id=8536) |
| 8537 | EL71v45 | [Своя структура подменю в моих файлах<br>Own structure of sub-menu in card-explorer](https://patches.kibab.com/patches/details.php5?id=8537) |
| 5176 | M55v11 | [Список ссылок<br>Entrypoints list](https://patches.kibab.com/patches/details.php5?id=5176) |
| 5177 | M55v11 | [При нажатии стрелки вниз открываются группы<br>Down arrow - groups](https://patches.kibab.com/patches/details.php5?id=5177) |
| 1998 | M55v91 | [Список ссылок<br>Functions list](https://patches.kibab.com/patches/details.php5?id=1998) |
| 2131 | M55v91 | [Стрелка вниз &#9472;> группы<br>Down arrow -> Groups](https://patches.kibab.com/patches/details.php5?id=2131) |
| 2853 | M65v50 | [Список функций<br>Function list](https://patches.kibab.com/patches/details.php5?id=2853) |
| 634 | S45iv4 | [Замена стандартной вибры<br>Replace standard vibra](https://patches.kibab.com/patches/details.php5?id=634) |
| 640 | S45iv4 | [Список ссылок и звуков<br>Links & sound list](https://patches.kibab.com/patches/details.php5?id=640) |
| 2167 | S75v24 | [Отключить появление окна "Помощника" при старте телефона<br>Disable "Assistant" at startup](https://patches.kibab.com/patches/details.php5?id=2167) |
| 2541 | S75v26 | [Смена имени телефона в *#06#<br>Rename phone in *#06#](https://patches.kibab.com/patches/details.php5?id=2541) |
| 1688 | SL45iv56 | [Исправление предупредительного сигнала об окончании батарейки<br>Modify Battery Empty Warning Sound](https://patches.kibab.com/patches/details.php5?id=1688) |
| 1747 | SL45iv56 | [Скрыть, отцентрировать и т.п. дату и время<br>Remove, center etc. Date & Clock](https://patches.kibab.com/patches/details.php5?id=1747) |
| 1892 | SL45iv56 | [DSSM. Перемещение строки даты/часов и коллекция перемещений<br>DSSM. Date/time string style & movement collection](https://patches.kibab.com/patches/details.php5?id=1892) |
| 2076 | SL45iv56 | [MANM. Отключение микрофона во время работы автоответчика<br>MANM.](https://patches.kibab.com/patches/details.php5?id=2076) |
| 9077 | SL65v53 | [Отключение некоторых иконок в иконбаре<br>Disable some icons in iconbar](https://patches.kibab.com/patches/details.php5?id=9077) |
### RTF patches
This is not an error, but the RTF format is legacy and less portable.

| ID | Model | PATCH |
|---|---|---|
| 3127 | SL45iv56 | [Изменить вид софтов без функции<br>Modify the picture of the softkey having no function](https://patches.kibab.com/patches/details.php5?id=3127) |
