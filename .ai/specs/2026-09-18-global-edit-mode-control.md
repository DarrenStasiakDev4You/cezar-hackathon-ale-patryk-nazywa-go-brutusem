# Kontrolka trybu edycji głównego widoku widgetów

## 📋 TLDR

Dodajemy wyłącznie mechanizm wejścia i wyjścia z trybu edycji w głównym widoku widgetów. Globalny shell renderuje stale widoczną kontrolkę `EditModeControl` w prawym górnym rogu. Kontrolka składa się z ikony związanej z edycją layoutu oraz tekstu „Edit mode”, tworzących jeden klikalny element. Włączenie trybu pokazuje stały pasek „You are in edit mode” z przyciskiem „Exit edit mode”; nie otwiera modala i nie dodaje jeszcze edycji widgetów.

## 📋 Problem

Użytkownik nie ma stałego, jednoznacznego wejścia do trybu edycji głównego widoku widgetów. Kontrolka musi być widoczna niezależnie od treści, nie może zostać przykryta przez widgety ani sticky elementy, a jej obszar musi być uwzględniony w układzie desktopowym, tabletowym i mobilnym.

## 📋 Zakres

W zakresie:

- dodanie `EditModeControl` do globalnego shellu,
- umieszczenie kontrolki w prawym górnym rogu głównego widoku widgetów,
- użycie ikony związanej z edycją layoutu, np. `PanelsTopLeftIcon` lub `LayoutDashboardIcon`,
- połączenie ikony i tekstu „Edit mode” w jeden klikalny element,
- bezpieczna warstwa nad treścią (`z-index`),
- rezerwacja miejsca i przesuwanie kolidującego elementu w lewo,
- obsługa desktopu, tabletu, mobile, safe-area oraz Light/Dark mode,
- wejście i wyjście z trybu edycji.

Poza zakresem:

- edycja, przenoszenie, zmiana rozmiaru lub usuwanie widgetów,
- zapisywanie układu,
- API, persystencja, uprawnienia i synchronizacja,
- modal przy wejściu w tryb,
- wyszarzanie interfejsu lub zmiana wyglądu widgetów podczas hover/focus.

## 📋 Proponowane rozwiązanie

`EditModeControl` jest montowany raz przez globalny shell, poza drzewem widgetów i routowaną treścią. W stanie nieaktywnym wyświetla ikonę layoutu oraz tekst „Edit mode”. Kliknięcie natychmiast ustawia lokalny stan `enabled=true` i pokazuje pasek statusu. Nie otwiera się modal.

Podczas aktywnego trybu:

- kontrolka nadal jest widoczna w prawym górnym rogu,
- pojawia się stały pasek z tekstem „You are in edit mode”,
- pasek ma przycisk „Exit edit mode”,
- kliknięcie przycisku ustawia `enabled=false` i usuwa pasek,
- nie zachodzi żadna edycja widgetów.

## 📋 Architektura

### Komponent i warstwa

- Komponent: `packages/web/src/components/edit-mode-control.tsx`.
- Montaż: dokładnie raz w `AppShell`, obok głównego layoutu, a nie wewnątrz pojedynczego widgetu.
- Ikona: `PanelsTopLeftIcon` albo `LayoutDashboardIcon`; nie używać ikony koła zębatego/settings.
- Przycisk: istniejący `Button`, z jednym obszarem aktywacji obejmującym ikonę i napis.
- Stan: lokalny React state; bez storage i bez API.
- Pasek: osobny wiersz shellu albo równoważna rezerwacja miejsca, aby nie nakładał się na sticky header widoku.

### Rezerwacja miejsca i kolizje

Kontrolka otrzymuje osobną warstwę nad treścią oraz stały obszar bezpieczny w prawym górnym rogu. Główny widok widgetów nie może być układany pod kontrolką. Jeżeli widget lub inny element znalazłby się w jej obszarze, layout musi zarezerwować szerokość kontrolki i przesunąć ten element w lewo.

Rezerwacja musi uwzględniać:

- prawy i górny `safe-area-inset`,
- szerokość tekstu „Edit mode” oraz odstępy ikony,
- breakpoint desktop/tablet/mobile,
- aktywny pasek statusu nad główną treścią,
- stacking context i `z-index` elementów sticky/fixed.

## 📋 UI/UX

### Stan nieaktywny

- Prawy górny róg głównego widoku widgetów zawiera ikonę layoutu i tekst „Edit mode”.
- Ikona i tekst są jednym klikalnym elementem.
- Kontrolka jest widoczna nad widgetami i ma wyraźny focus-visible.
- Na mobile obszar kliknięcia ma minimum 44 px wysokości.

### Wejście

1. Użytkownik klika kontrolkę.
2. Tryb edycji aktywuje się natychmiast.
3. Nie pojawia się modal ani toast wymagający potwierdzenia.
4. Nad widokiem widgetów pojawia się pasek z tekstem „You are in edit mode” i przyciskiem „Exit edit mode”.

### Wyjście

1. Użytkownik klika „Exit edit mode”.
2. Tryb zostaje wyłączony.
3. Pasek znika.
4. Kontrolka „Edit mode” pozostaje dostępna w prawym górnym rogu.
5. Widok nie nawiguje i nie przeładowuje strony.

### Responsywność i motywy

- Desktop: pełna etykieta jest widoczna, a widgety respektują zarezerwowaną przestrzeń.
- Tablet: kontrolka zachowuje etykietę, jeśli mieści się bez kolizji; w przeciwnym razie może użyć kompaktowego układu z dostępną nazwą.
- Mobile: kontrolka pozostaje osiągalna, ma touch target minimum 44 px i respektuje safe-area.
- Light/Dark mode: kontrolka, pasek i focus-visible korzystają z istniejących tokenów i zachowują czytelny kontrast.

## 📋 Model danych i API

Brak zmian. Stan jest lokalnym booleanem Reacta. Nie dodajemy endpointu, schematu, migracji, storage key, SSE ani WebSocket topicu.

## 📋 Przypadki brzegowe

- Wielokrotne kliknięcie kontrolki nie tworzy wielu pasków.
- Nawigacja między stronami nie zasłania kontrolki; shell pozostaje jej właścicielem.
- Widget nie może przykryć kontrolki przez własny `z-index`.
- Aktywny pasek nie może zasłonić sticky headera ani przesuwać treści przez overlay; treść zaczyna się poniżej paska.
- Zmiana szerokości viewportu nie może powodować poziomego overflow.
- Zmiana motywu podczas aktywnego trybu zachowuje kontrast i widoczność kontrolki.

## 📋 Plan implementacji

1. Dodać `EditModeControl` z ikoną `PanelsTopLeftIcon` lub `LayoutDashboardIcon`, tekstem „Edit mode” i lokalnym stanem `enabled`.
2. Zamontować komponent w `AppShell` jako niezależny element nad głównym widokiem widgetów.
3. Dodać pasek „You are in edit mode” z przyciskiem „Exit edit mode”; bez modala i bez funkcji edycji widgetów.
4. Dodać responsywną rezerwację miejsca, safe-area, warstwę `z-index` oraz przesuwanie kolidującej treści w lewo.
5. Dodać testy komponentu i layoutu dla wejścia, wyjścia, braku duplikacji, desktop/tablet/mobile, Light/Dark mode i dostępności.
6. Zweryfikować makietę i implementację w przeglądarce, gdy dostępne będzie środowisko testowe.

## 📋 Kryteria akceptacji

- [ ] `EditModeControl` jest zamontowany w globalnym shellu głównego widoku widgetów.
- [ ] Kontrolka jest w prawym górnym rogu i stale pokazuje ikonę edycji layoutu oraz tekst „Edit mode”.
- [ ] Ikona nie jest ikoną koła zębatego/settings; używa ikony adekwatnej do edycji layoutu.
- [ ] Ikona i tekst są jednym klikalnym elementem.
- [ ] Kontrolka znajduje się nad treścią i nie może zostać przykryta przez widget, sticky header ani inny element.
- [ ] Layout rezerwuje miejsce dla kontrolki i przesuwa kolidujący element w lewo.
- [ ] Kliknięcie natychmiast włącza tryb, bez modala i bez toastu.
- [ ] Po wejściu pojawia się pasek „You are in edit mode” z przyciskiem „Exit edit mode”.
- [ ] Kliknięcie „Exit edit mode” usuwa pasek bez nawigacji i przeładowania.
- [ ] Desktop, tablet, mobile, safe-area, Light mode i Dark mode są obsłużone.
- [ ] Nie dodano żadnej funkcjonalności edycji widgetów ani zmian API/persystencji.

## 📎 Makieta

Makieta HTML znajduje się w `assets/global-edit-mode-control/mockup-01-widget-shell.html`. Pokazuje widok desktopowy oraz responsywne zachowanie kontrolki i paska statusu.

