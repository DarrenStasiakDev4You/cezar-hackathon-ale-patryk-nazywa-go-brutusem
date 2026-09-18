# Centralny strażnik interakcji w trybie edycji

## 📋 TLDR

Rozszerzamy istniejący globalny `editMode` w shellu o centralny mechanizm, który przechwytuje aktywacje elementów interaktywnych i nie dopuszcza do nawigacji ani akcji biznesowych. Wyjątkiem są akcje należące do edytora layoutu oraz opcjonalne otwarcie dropdownu potrzebne do identyfikacji elementu.

## Założenia rozstrzygnięte autonomicznie

- **Q1 — Zakres istniejącej kontrolki a osobna zmiana:** To osobna specyfikacja rozszerzająca istniejącą kontrolkę i branch `feat/global-edit-mode-control`; wcześniejsza specyfikacja pozostaje źródłem prawdy dla wejścia/wyjścia i warstwy wizualnej.
- **Q2 — Dozwolone wyjątki:** Domyślnie dozwolone są tylko akcje oznaczone jako należące do edytora; dropdown może otworzyć się wyłącznie przez jawny marker, ale jego elementy biznesowe pozostają zablokowane.
- **Q3 — Zakres zdarzeń:** Strażnik blokuje aktywacje użytkownika (`click`, aktywację formularza i równoważne wejście klawiaturą), ale nie blokuje programowych przekierowań niezwiązanych z aktywacją oraz zdarzeń hover/focus potrzebnych do inspekcji.

## 📋 Problem

Branch `feat/global-edit-mode-control` posiada już `editMode` w `AppShell`, wyszarza powierzchnię shella, utrzymuje aktywny pasek/kontrolkę edycji i blokuje kliknięcia w linki na granicy shella. To jednak tylko częściowa ochrona: przyciski, elementy menu, wyzwalacze command palette, wysłanie formularza i własne elementy interaktywne nadal mogą wykonać callbacki biznesowe, gdy użytkownik wybiera lub edytuje layout. Dodawanie `if (editMode)` do każdego widgetu dublowałoby politykę, pomijało przyszłe widgety i domyślnie nie chroniłoby treści rozszerzeń.

Niezmiennik jest prosty: tryb normalny zachowuje bieżące zachowanie aplikacji, a tryb edycji zamienia aktywację użytkownika w interakcję edytora albo w brak akcji — nigdy w nawigację ani zmianę biznesową. Wizualne affordance hover/focus pozostają dostępne, ponieważ pomagają zidentyfikować element przeznaczony do edycji.

## 📋 Proponowane rozwiązanie

Dodajemy jeden strażnik interakcji należący do shella, w tej samej globalnej granicy, która posiada `editMode`. Strażnik działa podczas przechwytywania zdarzeń aktywacji użytkownika i stosuje następującą politykę:

| Kontekst | Rezultat w trybie edycji |
|---|---|
| Tryb normalny | Istniejące zachowanie linków, przycisków, formularzy, dropdownów i widgetów pozostaje bez zmian. |
| Kontrolka należąca do edytora | Akcja trybu edycji może się wykonać. |
| Jawnie oznaczony trigger dropdownu inspekcyjnego | Menu może się otworzyć, aby użytkownik mógł zidentyfikować element; jego akcje biznesowe nadal są chronione. |
| Każdy inny link, przycisk, submit lub element interaktywny | Domyślna akcja i biznesowy handler potomny są blokowane. |
| Hover, focus, ruch wskaźnika i zaznaczanie tekstu | Dozwolone; inspekcja i wizualne ujawnienie nadal działają. |
| Programowa nawigacja niezwiązana z aktywacją użytkownika | Poza zakresem tego strażnika i pozostaje bez zmian. |

Implementacja powinna udostępniać wąską politykę DOM, a nie kontekst Reacta, który każdy widget musiałby konsumować. Istniejące i przyszłe widgety są chronione domyślnie. Edytor może jawnie oznaczyć bezpieczną akcję atrybutem danych, a trigger dropdownu może osobno zezwolić wyłącznie na otwarcie. Atrybuty są kontraktem infrastruktury, nie warunkiem dodawanym ręcznie do każdego widgetu.

Strażnik musi obejmować aktywację wskaźnikiem i klawiaturą. Powinien również chronić wysłanie formularza na granicy shella, ponieważ Enter na skupionym przycisku submit może ominąć politykę opartą wyłącznie na kliknięciach. Nie należy używać `pointer-events: none`, globalnego disabled ani nieprzezroczystej nakładki — te techniki usuwają semantykę hover/focus i uniemożliwiają edytorowi znalezienie elementu.

Punktem wyjścia jest istniejący na branchu handler `onClickCapture`, który chroni wyłącznie linki. Źródłem implementacji pozostaje `packages/web/src/components/app-shell.tsx`; mały moduł/helper jest preferowany, jeśli pozwoli niezależnie testować macierz zdarzeń. Istniejący `EditModeControl` pozostaje jedynym chrome edytora w tym zakresie.

### Wnioski z researchu

Granica odpowiada rozróżnieniu stosowanemu w narzędziach projektowych: edycja i podgląd/prototypowanie są osobnymi trybami interakcji, więc płótno może ujawniać strukturę bez wykonywania wynikowego przepływu. Figma opisuje osobne tryby Design i Prototype oraz triggery zależne od trybu ([przewodnik Figma](https://help.figma.com/hc/en-us/articles/360040314193-Guide-to-prototyping-in-Figma), [triggery prototypu Figma](https://help.figma.com/hc/en-us/articles/360035725574-Prototype-triggers)). WordPress podobnie traktuje edycję linku jako operację edytora na treści, która normalnie prowadziłaby do nawigacji ([edycja linków w WordPress](https://wordpress.org/documentation/article/link-editing/)). Proponowane rozwiązanie wykorzystuje z tych wzorców centralne posiadanie trybu i jawne affordance edytora, ale nie wprowadza silnika prototypowania ani nowego API widgetów.

## 📋 Architektura

### Własność i przepływ zdarzeń

1. `AppShell` posiada istniejący boolean `editMode` i montuje strażnika raz, wokół routowanej powierzchni.
2. Handler capture otrzymuje aktywację przed biznesowym callbackiem potomka.
3. Strażnik znajduje najbliższy cel interaktywny i klasyfikuje go jako `editor`, `inspectable-dropdown` albo `business/default`.
4. Dla `business/default` wywołuje `preventDefault()` i zatrzymuje propagację, aby nie uruchomiły się nawigacja routera, callback przycisku, wybór menu, submit formularza ani akcja widgetu.
5. Dla `editor` pozostawia zdarzenie bez zmian. Dla `inspectable-dropdown` pozwala wyłącznie na otwarcie triggera; aktywacja elementu menu nadal jest klasyfikowana jako `business/default`.

Klasyfikacja musi działać na złożonym celu zdarzenia i najbliższym przodku, aby kliknięcie ikony lub etykiety wewnątrz przycisku było zarządzane przez przycisk. Musi też tolerować portale: otwarte menu renderowane poza wizualną powierzchnią shella nie może ominąć strażnika. Jeśli portal biblioteki UI opuszcza drzewo Reacta, implementacja powinna użyć najmniejszej wspólnej granicy zdarzeń, która nadal go obejmuje, i opisać tę granicę w testach.

Zalecane markery:

- `data-edit-mode-action="allow"`: akcja należąca do edytora, bezpieczna w trybie edycji;
- `data-edit-mode-open="allow"`: opcjonalny trigger, który może otworzyć menu do identyfikacji; nie daje prawa do wykonywania elementów menu;
- `data-edit-mode-ignore`: wyłącznie dla nieinteraktywnej treści prezentacyjnej, jeśli klasyfikator potrzebuje wyjątku; nigdy nie może zezwalać na akcję biznesową.

Markery należy zastosować do istniejącej kontrolki trybu edycji i przycisku wyjścia w ich implementacji. Żaden widget produktowy nie powinien czytać `editMode`. Jeśli przyszły widget będzie potrzebował prawdziwej akcji edytora, jawnie oznacza tę akcję i testuje jej bezpieczeństwo.

### Kontrakt zdarzeń

- `click`: główna granica aktywacji wskaźnikiem i klawiaturą; domyślnie blokowana w trybie edycji;
- `submit`: domyślnie blokowany w trybie edycji, również dla implicit submit; formularze edytora muszą jawnie uzyskać zgodę;
- `keydown`: blokować tylko klawisze, które aktywują chroniony element, jeśli biblioteka nie emituje na czas anulowalnego clicka; nie blokować strzałek, Escape, Tab, edycji tekstu ani nawigacji czytnika ekranu;
- `pointerdown`, `pointerup`, `mouseenter`, `focus`, `focusin`: pozostają dostępne, chyba że konkretna biblioteka menu wymaga udokumentowanego wyjątku triggera.

Strażnik jest synchroniczny i lokalny. Nie dodaje API, storage, topicu event-busa, globalnego listenera przeglądarki ani persystencji. Nie przechwytuje nawigacji wywołanej przez efekt, odpowiedź serwera albo zewnętrzny callback — nie są to aktywacje interaktywnego widgetu i nie powinny być po cichu zmieniane przez edit mode.

## 📋 Model danych

Brak zmian modelu danych. `editMode` pozostaje booleanem w pamięci shella. Atrybuty `data-edit-mode-*` są wyłącznie markerami polityki DOM; nie są zapisywanymi danymi użytkownika, konfiguracją ani payloadem API.

## 📋 Kontrakty API

Brak zmian HTTP, SSE, WebSocket, CLI i kontraktu rozszerzeń. Implementacja dodaje wyłącznie wewnętrzną granicę polityki zdarzeń w webie oraz testy. Jeśli markery zostaną później użyte przez komponenty rozszerzeń, osobny follow-up musi zdefiniować i wersjonować kontrakt rozszerzeń; ta specyfikacja go nie publikuje.

## 📋 UI/UX

Zachowanie wizualne z wcześniejszej specyfikacji globalnego trybu edycji pozostaje bez zmian: użytkownik wchodzi i wychodzi przez kontrolkę shella, pasek pozostaje widoczny, routowana powierzchnia może się wyszarzać i ujawniać po hover/focus, a sama kontrolka pozostaje wyraźna i operacyjna.

Zachowanie interakcji staje się jednoznaczne:

- W trybie normalnym kliknięcie linku zmienia trasę, kliknięcie przycisku wykonuje bieżącą akcję widgetu, a otwarcie i wybór dropdownu działa jak dotychczas.
- W trybie edycji kliknięcie tego samego linku nie zmienia trasy, biznesowy przycisk nie zmienia stanu aplikacji, formularz nie jest wysyłany, a biznesowy element menu nie wykonuje swojej akcji. Menu może zostać zamknięte przez własną bibliotekę, ale bez skutku biznesowego.
- Kontrolka edytora i akcja wyjścia pozostają operacyjne. Ich nazwa dostępnościowa, focus ring i aktywacja klawiaturą muszą działać.
- Opcjonalny dropdown inspekcyjny może otworzyć się, aby ujawnić etykiety lub strukturę, ale samo otwarcie nie może nawigować, zmieniać danych, wysyłać formularza ani uruchamiać komendy. Domyślnie dropdown pozostaje chroniony.

### Dostępność

Nie należy ogłaszać każdego zablokowanego kliknięcia jako błędu ani przenosić fokusu. Zachować fokus klawiatury, nawigację Tab i widoczne wskaźniki fokusu. Aktywny pasek/status z istniejącej kontrolki pozostaje komunikatem o trybie. Jeśli zablokowana akcja będzie wymagała informacji zwrotnej, powinna użyć przyszłego affordance wyboru edytora, a nie toastu, który sam mógłby uruchomić akcję biznesową.

## 📋 Przypadki brzegowe i scenariusze awarii

- **Zagnieżdżone cele:** kliknięcie SVG/ikony/spanu wewnątrz przycisku rozpoznaje przycisk, a nie dekoracyjne dziecko.
- **Linki routera:** zarówno własny wrapper `Link`, jak i zwykłe linki `react-router` są domyślnie blokowane.
- **Menu w portalu:** treść renderowana w portalu przez Radix lub podobną bibliotekę nie może ominąć strażnika. Dodać test regresyjny dla faktycznego prymitywu używanego przez shell.
- **Trigger a element menu:** jawnie dozwolony trigger może się otworzyć; element destrukcyjny lub nawigacyjny nadal jest blokowany, chyba że sam należy do edytora.
- **Implicit submit:** Enter w polu nie wysyła biznesowego formularza w trybie edycji.
- **Aktywacja klawiaturą:** Space/Enter dla przycisków i linków jest objęte ochroną bez wyłączania zwykłej nawigacji fokusem ani wpisywania tekstu.
- **Zagnieżdżone kontrolki edytora:** akcja edytora jest dozwolona tylko wtedy, gdy najbliższy marker dotyczy zamierzonej akcji; biznesowy przodek nie może odzyskać sterowania przez bubbling.
- **Wielokrotne kliknięcia i zmiana trybu:** wyjście z edit mode podczas dozwolonej akcji nie może odtworzyć wcześniej zablokowanego zdarzenia. Nie wprowadzać kolejki ani odroczonego replayu.
- **Linki natywne i zewnętrzne:** są blokowane tak samo jak wewnętrzne; nie mogą otworzyć nowej karty ani okna.
- **Przekierowania niepochodzące od użytkownika:** istniejąca zmiana trasy wywołana efektem lub zewnętrznym callbackiem pozostaje poza zakresem; strażnik nie może powodować pętli ani nieaktualnego stanu.
- **Brak JavaScriptu/hydratacji:** statyczny shell powinien nadal wystartować; strażnik jest ulepszeniem aktywowanym po przejęciu shella przez React.

## 📋 Ryzyka i wpływ

- **Wysokie — niepełne pokrycie:** strażnik oparty wyłącznie na clicku lub anchorach pozostawi aktywne biznesowe przyciski i formularze. Macierz zdarzeń i testy regresyjne są obowiązkowe.
- **Średnie — kolejność zdarzeń biblioteki UI:** portale Radix i kolejność zdarzeń syntetycznych/natywnych mogą się różnić. Trzeba zweryfikować faktyczny prymityw dropdownu i utrzymać helper niezależny od szczegółów biblioteki.
- **Średnie — nadmierne blokowanie chrome edytora:** szerokie `stopPropagation()` może zepsuć akcję wyjścia lub przyszłe narzędzia wyboru. Każda kontrolka edytora potrzebuje jawnych testów allow.
- **Niskie — regresje klawiatury:** zbyt szerokie blokowanie `keydown` może pogorszyć dostępność. Preferować anulowalny capture `click`/`submit` i dodawać obsługę klawiszy tylko po udowodnieniu luki testem.

Rollback to revert jednego commita: usunięcie podpięcia strażnika i helpera przy zachowaniu istniejącej kontrolki oraz wizualnego edit mode. Brak migracji danych, zmian manifestów wydania, kontraktu API i powierzchni kompatybilności wstecznej.

## 📋 Fazowanie

### Faza 1: Centralny punkt polityki

Wprowadzić klasyfikator/strażnika zdarzeń i połączyć go z istniejącym `editMode` shella. Oznaczyć tylko istniejące akcje wejścia/wyjścia jako należące do edytora. Tryb normalny działa bez zmian, a aktywacje biznesowe w edit mode są domyślnie blokowane.

### Faza 2: Pokrycie prymitywów

Przetestować faktyczne linki routera, przyciski, command palette, trigger/menu dropdownu i formularze używane przez shell. Dodać marker inspectable-dropdown wyłącznie tam, gdzie konkretny przepływ identyfikacji/edycji tego wymaga.

### Faza 3: Przeglądarka i dostępność

Zweryfikować aktywację wskaźnikiem i klawiaturą w trybie normalnym i edycji, na desktopie i mobile, w tym menu renderowane w portalu. Potwierdzić działanie fokusu, hover reveal, Escape, Tab, wpisywania tekstu i wyjścia z trybu.

## 📋 Plan implementacji

1. **Zmapować obecną powierzchnię.** Przeanalizować diff `feat/global-edit-mode-control` i współdzielone prymitywy używane przez `AppShell`; wypisać każdą aktywację użytkownika, którą trzeba chronić. Wynik testowalny: macierz fixture obejmująca link, router link, przycisk, element menu, submit formularza, własny element `tabIndex`, kontrolkę edytora i wyjście.
2. **Zaimplementować centralny klasyfikator.** Dodać mały helper/komponent należący do shella, który klasyfikuje najbliższe cele interaktywne i udostępnia dwa jawne markery edytora. Wynik testowalny: testy jednostkowe dla zagnieżdżonych celów, domyślnego blokowania, allow edytora, triggera dropdownu inspekcyjnego i przepuszczania w trybie normalnym.
3. **Zastąpić strażnika tylko linków.** Podłączyć capture `click`/`submit` w `AppShell` i dodać wyłącznie niezbędną obsługę klawiatury. Wynik testowalny: testy shella potwierdzają, że trasa, callback, wybór menu i submit nie wykonują się w edit mode, a kontrolki wejścia/wyjścia działają.
4. **Pokryć portale i prymitywy.** Użyć faktycznych komponentów menu/formularzy, również z renderowaniem portalowym. Wynik testowalny: test regresyjny potwierdza, że biznesowy element w portalu nie omija strażnika, a jawnie oznaczony trigger może się otworzyć bez wykonania akcji elementu.
5. **Zweryfikować dostępność i przeglądarkę.** Wykonać scenariusze klawiatury i wskaźnika w trybie normalnym i edycji, w Light/Dark oraz przy responsywności; potwierdzić brak utraty fokusu, przesunięcia layoutu, przypadkowej nawigacji i zmiany biznesowej. Wynik testowalny: dowód przeglądarkowy i krótka macierz pass/fail.
6. **Uruchomić gate repozytorium.** Wykonać skonfigurowany typecheck, testy jednostkowe/pełne, build i testy paczki. Wynik testowalny: wszystkie komendy przechodzą, a ewentualne niezwiązane awarie są udokumentowane.

## 📋 Kryteria akceptacji

- [ ] W trybie normalnym istniejące zachowanie linków, przycisków, formularzy, dropdownów i widgetów pozostaje bez zmian.
- [ ] W trybie edycji kliknięcie linku wewnętrznego lub zewnętrznego nie zmienia trasy, nie otwiera karty i nie przeładowuje dokumentu.
- [ ] W trybie edycji biznesowe przyciski i własne elementy interaktywne nie wykonują callbacków.
- [ ] W trybie edycji biznesowe formularze nie wysyłają się przez kliknięcie, Enter ani implicit submit.
- [ ] W trybie edycji biznesowe elementy dropdownów nie wykonują komend, mutacji ani nawigacji.
- [ ] Jawnie oznaczony trigger dropdownu inspekcyjnego może się otworzyć, ale nie daje prawa do wykonania jego elementów.
- [ ] Istniejące kontrolki wejścia/wyjścia pozostają dostępne klawiaturą i wskaźnikiem oraz są jedynymi dozwolonymi akcjami w tym zakresie.
- [ ] Hover, focus, Tab, Escape, zaznaczanie tekstu i nawigacja czytnika ekranu pozostają dostępne; wizualny kontrakt reveal się nie zmienia.
- [ ] Strażnik jest zamontowany raz na granicy shella; żaden widget nie dodaje `if (editMode)` do ochrony własnego zachowania.
- [ ] Testy pokrywają zagnieżdżone cele, linki routera/zwykłe, przyciski, formularze, portale dropdownów, aktywację klawiaturą i przepuszczanie w trybie normalnym.
- [ ] Nie dodano API, storage, persystencji, uprawnień, synchronizacji ani funkcji edycji widgetów.

## 📎 Kontekst i dowody

- Kontekst implementacyjny: branch `feat/global-edit-mode-control`, w szczególności `packages/web/src/components/app-shell.tsx`, `packages/web/src/components/edit-mode-control.tsx` i `packages/web/src/styles/index.css`.
- Istniejące źródło projektowe: `.ai/specs/2026-09-18-global-edit-mode-control.md` z PR #1.
- Makieta: `assets/global-edit-mode-interaction-guard/mockup-01-interaction-guard.html`.
