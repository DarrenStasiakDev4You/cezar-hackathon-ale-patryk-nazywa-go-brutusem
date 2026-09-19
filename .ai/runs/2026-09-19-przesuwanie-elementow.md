# Implementacja: przesuwanie elementów w layoucie

Goal: dodać lokalne, dostępne reorderowanie zarejestrowanych elementów layoutu w globalnym trybie edycji, bez persystencji, API i przenoszenia między rodzicami.

Scope: `packages/web/src/lib/layout-elements.ts`, komponenty layoutu i sortowalnej powierzchni, istniejący guard edit mode, style oraz testy jednostkowe/komponentowe.

Non-goals: zapis layoutu, HTTP/CLI, rozszerzenia, resize, usuwanie, przenoszenie między rodzicami i nowe zależności.

Source doc: `.ai/specs/2026-09-19-przesuwanie-elementow.md`

## Implementation Plan

### Faza 1: uporządkowany model layoutu

- [x] 1.1 Zmapować miejsca użycia rejestru, wrappera i edit mode oraz ustalić kontrakt powierzchni sortowania. — e0fde1af
- [x] 1.2 Dodać stabilną kolejność rodzeństwa i `getSiblingIds`, zachowując lifecycle rejestracji. — e0fde1af
- [x] 1.3 Zaimplementować `moveWithinParent` z walidacją rodzica, celu i własnego poddrzewa. — e0fde1af
- [x] 1.4 Zapewnić niemutowalne snapshoty i pojedynczą publikację udanej zmiany. — e0fde1af

### Faza 2: przeciąganie wskaźnikiem i dotykiem

- [x] 2.1 Dodać sortowalną powierzchnię opartą o dnd-kit, aktywną wyłącznie w edit mode. — 082058fc
- [x] 2.2 Podłączyć jawny uchwyt, sensor dystansu 6 px i atrybut przepuszczający guard. — 082058fc
- [x] 2.3 Dodać DragOverlay, wskaźnik miejsca docelowego i obsługę celu rodzeństwa. — 082058fc
- [x] 2.4 Zatwierdzać reorder wyłącznie w `onDragEnd`; anulowanie i błędny cel nie zmieniają rejestru. — 082058fc
- [x] 2.5 Traktować grupę jako pojedynczy wpis bez zmiany rodziców dzieci. — 082058fc

### Faza 3: klawiatura, guard i regresje UX

- [x] 3.1 Dodać klawiaturowe współrzędne, Space/strzałki/Escape i region aria-live. — 28a9292c
- [x] 3.2 Pokryć macierz hover/focus/click/contextmenu/drag oraz brak aktywacji biznesowej akcji. — 28a9292c
- [x] 3.3 Zweryfikować mobile, touch scrolling, motywy, focus-visible i uchwyt 44 px. — 28a9292c
- [ ] 3.4 Uruchomić pełny gate repozytorium i opisać wyniki.

## Validation notes

- `npm run typecheck`: passed after allowing the esbuild child process.
- Targeted web validation: passed — 4 files, 29 tests.
- `npm test`: blocked by numerous pre-existing server/workspace failures unrelated to the changed web files; the run was stopped after the failures were confirmed across independent suites.
- `npm run test:unit`: failed in two platform-dependent tests that invoke unavailable POSIX commands (`mkdir`, `/bin/sh`).
- `npm run build`: passed, including server build, web build, and package checks.
- `npm run test:package`: failed in the release-tarball CLI test with Windows `spawn EINVAL`; the remaining 15 package tests passed.

## Risks

- Największe ryzyko to podłączenie sensora do całej karty zamiast uchwytu; ograniczamy je przez osobny `setActivatorNodeRef` i testy interakcji.
- Kolejność musi mieć jedno źródło prawdy w rejestrze; DOM pozostaje wyłącznie projekcją.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Faza 1: uporządkowany model layoutu

- [x] 1.1 Zmapować miejsca użycia rejestru, wrappera i edit mode oraz ustalić kontrakt powierzchni sortowania. — e0fde1af
- [x] 1.2 Dodać stabilną kolejność rodzeństwa i `getSiblingIds`, zachowując lifecycle rejestracji. — e0fde1af
- [x] 1.3 Zaimplementować `moveWithinParent` z walidacją rodzica, celu i własnego poddrzewa. — e0fde1af
- [x] 1.4 Zapewnić niemutowalne snapshoty i pojedynczą publikację udanej zmiany. — e0fde1af

### Faza 2: przeciąganie wskaźnikiem i dotykiem

- [x] 2.1 Dodać sortowalną powierzchnię opartą o dnd-kit, aktywną wyłącznie w edit mode. — 082058fc
- [x] 2.2 Podłączyć jawny uchwyt, sensor dystansu 6 px i atrybut przepuszczający guard. — 082058fc
- [x] 2.3 Dodać DragOverlay, wskaźnik miejsca docelowego i obsługę celu rodzeństwa. — 082058fc
- [x] 2.4 Zatwierdzać reorder wyłącznie w `onDragEnd`; anulowanie i błędny cel nie zmieniają rejestru. — 082058fc
- [x] 2.5 Traktować grupę jako pojedynczy wpis bez zmiany rodziców dzieci. — 082058fc

### Faza 3: klawiatura, guard i regresje UX

- [x] 3.1 Dodać klawiaturowe współrzędne, Space/strzałki/Escape i region aria-live. — 28a9292c
- [x] 3.2 Pokryć macierz hover/focus/click/contextmenu/drag oraz brak aktywacji biznesowej akcji. — 28a9292c
- [x] 3.3 Zweryfikować mobile, touch scrolling, motywy, focus-visible i uchwyt 44 px. — 28a9292c
- [ ] 3.4 Uruchomić pełny gate repozytorium i opisać wyniki.
