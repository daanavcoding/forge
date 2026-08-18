# Forge v3 — plan de reconstrucción

Fecha: 2026-08-03. Base: benchmarks del 01 y 03 de agosto e histórico de sesiones de Claude Code del usuario.

## 1. Diagnóstico medido

### Calidad, coste y fiabilidad

- Juez ciego Sonnet 5, 8 escenarios (`judge-forge8-2026-08-01`): Forge gana 1 (`ledger-service-java`), empata 3 con diffs idénticos (`hello-fastapi`, `volume-discounts`, `tasks-api-node`) y pierde 3 (`cache-ttl-node`, `retry-agent-langgraph`, `error-contract-fastapi`). En `cache-ttl-node`, corrección baja de 5 a 3.
- `context-cache-2026-08-03`: Forge cuesta 1.006.061 unidades equivalentes frente a 403.321 de baseline (**2,5x**).

| escenario | baseline | forge | ratio |
|---|---:|---:|---:|
| hello-fastapi | 46.512 | 320.812 | 6,9x |
| tasks-api-node | 52.663 | 165.389 | 3,1x |
| ledger-service-java | 85.887 | 206.018 | 2,4x |
| tasks-minimal-api-dotnet | 86.198 | 173.556 | 2,0x |
| volume-discounts-node | 46.094 | 58.991 | 1,3x |
| cache-ttl-node | 85.967 | 81.295 | 0,95x |

- Causa 1: prompts variables destruyen la caché. Cache-read baseline/Forge: `cache-ttl-node` 174.080/0; `tasks-minimal-api-dotnet` 161.024/0; `volume-discounts-node` 143.872/0; `tasks-api-node` 151.040/14.080; `hello-fastapi` 116.480/59.392; `ledger-service-java` 136.960/64.512. Graphify y Headroom reescriben contexto y agravan esto si se aplican a ciegas.
- Causa 2: output total 25.379/97.243 (**3,8x**); con coste 6x, parches JSON de ficheros completos y reintentos dominan el gasto.
- `error-contract-fastapi`: `completed: false`, 5 llamadas, 922 s, 41.278 tokens de output (37.574 de razonamiento).
- Histórico: hilo principal 14.420 requests, 1.866 Mtok cache-read, 12,0 Mtok output; subagentes 4.409, 392 Mtok y 1,0 Mtok. Cada spawn arranca con ~19k tokens de media, hasta 154k, normalmente sin caché.

### Código actual

Conservar sólo:

1. Identidad de caché por hash de fichero (`cache.mjs`).
2. Puerta `validateLosslessResult`: aplicar una optimización sólo si ahorra ≥N tokens, es sin pérdida y no aumenta contexto; extenderla a toda optimización.
3. Fallback opcional de Graphify: su ausencia nunca bloquea.

Eliminar, tras validar v3, ~7.000/8.500 líneas: `engine.mjs`, `runs.mjs`, `runtime.mjs`, `providers.mjs`, `repository.mjs`, `contracts.mjs`, `policy.mjs`, `progress.mjs`, `context-audit.mjs` y `cache.mjs` actual. Causa raíz: Forge escribe mediante DSL JSON `search`/`replace` + `expected_sha256`; un byte distinto impide aplicar, y el modelo no puede leer, buscar, probar ni iterar normalmente.

## 2. Principios obligatorios

1. **Caché:** prefijo estable y ordenado; añadir bloques variables al final, no reescribir el inicio.
2. **Coste:** medir input, cache-read y output con multiplicadores reales; no “tokens” planos.
3. **Graphify/Headroom:** participan siempre; cada transformación se usa sólo si mejora coste neto sin pérdida. Si no, pasa el original.
4. **Subagentes:** antes de comprimir su contexto, comprobar si hace falta crearlos.
5. **Edición nativa:** sin DSL de parches. Anfitrión y subagentes leen, editan y prueban con herramientas normales.
6. **Ponytail obligatorio:** aplicar §7.
7. **`fast`:** fuerza velocidad rápida en toda fase con modelo —meta-prompt, planner, workers y reviewer— o falla claramente si no está disponible.
8. **Meta-prompt adaptativo:** siempre antes del planner; no inventa requisitos. Prompt completo se normaliza localmente; decisiones materiales requieren especificación y aprobación antes de escribir.
9. **Fin:** código verificado, no reviewer satisfecho. Anfitrión valida hallazgos y decide con requisitos, diff y comprobaciones.
10. **Fiabilidad mínima:** aislamiento, conflictos, recuperación, progreso, cancelación y resultado inequívoco; sin motores innecesarios.
11. **Reviewer no bloqueante:** error, salida inválida o repetición sin evidencia degradan a revisión nativa. Sólo defecto reproducible o aceptación roja bloquea.

## 3. Arquitectura

Única interfaz pública: `/forge <tarea>` (`$forge` en Codex). `fast` es opción del mismo comando; skills técnicas son internas.

```text
prompt → meta-prompt adaptativo → [aprobación si procede] → planner → orquestador
→ puerta determinista/agente → skills → implementación → verificaciones → reviewer
→ [corrección → verificaciones → comprobación dirigida] → decisión final del anfitrión
```

Piezas comunes:

- `worker-skills/*/SKILL.md`: catálogo privado, selección múltiple por extensiones, manifiestos, frameworks, tests, datos y fase.
- Plan JSON pequeño, una llamada: fases, dependencias, clasificación y aceptación.
- Puerta determinista/agente y protocolo nativo de orquestación.
- `bench/token-audit.mjs`: input/output/caché por sesión y subagente.

### Meta-prompt

1. Si objetivo, alcance, restricciones y fin comprobable ya están claros, normalización mecánica sin llamada ni aprobación; planner valida carencias antes de planificar.
2. Si el repositorio permite aclarar sin decidir por el usuario, una llamada produce especificación; original siempre acompaña para detectar desviaciones.
3. Si faltan decisiones materiales, mostrar especificación y pedir aprobación dentro del mismo comando; ninguna escritura o script antes.
4. `--approve-plan` fuerza aprobación; `--no-approve` sólo evita la opcional, nunca una decisión insegura/destructiva.

La salida separa hechos del usuario, hechos del repo, suposiciones reversibles y preguntas bloqueantes. Planner recibe original y especificación aprobada.

### Puerta determinista/agente

- **Determinista:** generar y ejecutar una vez un script para descargas, renombrados, migraciones mecánicas, formateo o generación repetitiva; cero modelo dentro del bucle.
- **De criterio:** subagente.
- Pocos subagentes, uno por responsabilidad y continuado con mensajes; nunca por fichero/ítem. Separar sólo por aislamiento, revisión independiente o paralelismo sin escrituras solapadas. Decide la medición, no un límite fijo.
- Antes de ejecutar código generado: validar objetivo, entradas, ruta y efectos. Aprobación normal para acciones destructivas/externas; preferir idempotencia, preflight y error visible; tratarlo como código no confiable.

### Protocolo del orquestador

1. Anfitrión valida dependencias, rutas sin solape y aceptación real por fase.
2. Ejecuta fases listas; paraleliza sólo escrituras no solapadas, ante duda serializa.
3. Clasifica determinista/subagente; selecciona skills internas e inyecta sólo instrucciones, tarea, criterios, contexto y restricciones. Worker mantiene sesión durante investigación, implementación y corrección.
4. Worker usa herramientas nativas; Forge no traduce ni reaplica cambios.
5. Ejecuta aceptación por fase y al final build/lint/typecheck/tests/bench relevantes. Dependencia ausente = no verificado, nunca éxito.
6. Reviewer limpio revisa una vez original, especificación, diff y resultados. Hallazgo válido incluye fichero/comportamiento, impacto y evidencia; estilo o duda sin evidencia no bloquea.
7. Anfitrión descarta falsos positivos y devuelve los válidos al worker dueño; corregir y repetir checks afectados.
8. Se permite una comprobación dirigida de hallazgos/regresiones, no otra revisión general. Si reviewer repite, contradice evidencia o falla, anfitrión prueba y resuelve directamente.
9. Defecto reproducible restante se corrige y verifica sin regresar al reviewer. Sólo bloqueo real de una sesión normal puede fallar; nunca `review rejected`, timeout o límite del reviewer.
10. Progreso compacto por etapa, cancelación e IDs de sesiones para reanudar; sin ledger extenso ni duplicar contexto.
11. `completed` sólo con aceptación verde, sin defectos reproducibles ni conflicto externo. Reviewer caído degrada a anfitrión. Resumen: cambios, comandos y resultados reales.

### Claude Code

- `/forge` en Markdown, única skill pública; sin motor.
- Agentes nativos `forge-planner`, `forge-worker`, `forge-reviewer`; worker se especializa con skills y se continúa por mensajes.
- Hook `UserPromptSubmit` sólo `additionalContext`, sin `decision: block`; matcher acotado igual que Codex.
- Reducir coste base de cada spawn: plugins, skills, MCP y `CLAUDE.md` no usados fuera.

### Codex

- Primera opción: sesión y subagentes nativos; nunca lanzar otro Codex dentro del anfitrión.
- `$forge` única skill pública; selección privada de `worker-skills` por fase, inyectada en orden estable.
- `codex exec` sólo fallback no interactivo: una sesión por responsabilidad y `codex exec resume`, nunca procesos por fichero ni sesiones nuevas por corrección.
- `fast` valida al inicio service tier compatible y lo registra; falla o pide otro modo, sin degradación silenciosa.
- Mantener `codex-hooks.json` con matcher acotado.

### Graphify y Headroom

- Graphify propone ficheros por fase; contrastar con manifiestos, rutas, dependencias directas y búsquedas. Ampliar ante duda; worker siempre puede leer más.
- Headroom sólo comprime bloques variables finales si la transformación es verificablemente sin pérdida y ahorra coste neto, incluido su coste y caché perdida.
- Ambos son internos, sin comandos/configuración del usuario. Ablaciones miden aporte y calibran puertas; no deciden su presencia.

## 4. Implementación

Construir v3 en paralelo. No borrar ni activar sobre v2 hasta pasar pruebas. Cada fase termina con `/ponytail-review`; aplicar hallazgos correctos o justificar rechazo.

| # | fase | entrega y aceptación |
|---|---|---|
| 0 | Parar sangrado | Matcher acotado y hook no bloqueante; prompts normales mantienen flujo nativo. |
| 1 | Congelar evidencia | Archivar bench, resultados, versiones y config reproducible fuera del runtime. |
| 2 | Bench nuevo | Runner aislado, escenarios §5 y brazo `solo`; mismo commit/config, repos limpios, resultados repetibles. |
| 3 | Protocolo | Plan pequeño, meta-prompt, cierre, corrección y adjudicación; tests de prompts detallado/ambiguo/bloqueante y reviewer inválido/ausente/repetitivo no bloqueante. |
| 4 | Claude vertical | Skill + agentes nativos implementan, prueban, revisan, corrigen bug inyectado y terminan en un comando aunque reviewer falle después. |
| 5 | Codex vertical | Delegación nativa y fallback `exec resume`; decisión final, permisos y feedback nativos; `fast` integral validado. |
| 6 | Skills/contexto | Catálogo privado, descubrimiento por fase y Graphify/Headroom con puerta; sólo Forge visible, multilenguaje correcto, menor coste neto y cero pérdida editable. |
| 7 | Fiabilidad | Conflictos, cancelación, reanudación, transitorios y scripts seguros; cero falso `completed`, cero cambios pisados, interrupción recuperable continúa. |
| 8 | Medir | Bench completo en ambos anfitriones y ablaciones; puertas §5 verdes con dispersión aceptable. |
| 9 | Sustituir/podar | Activar v3, retirar v2, `/ponytail-audit`; instalación/docs/tests verdes; archivar/eliminar v2 sólo tras corte. |

Bench antes de construir; borrado después de demostrar reemplazo. `npm test` y `npm run check` deben validar equivalentes v3, no quedar verdes por borrar tests.

## 5. Benchmarks

### Sustitución del bench viejo

Archivar resultados citados, commit, versiones, prompts, rúbricas y resúmenes reproducibles. Borrar runners sustituidos (`bench/ab.mjs`, `bench/codex.mjs`, `bench/context-cache.mjs`, `bench/rejudge*.mjs`) y baselines sólo tras validar v3. Limpiar `.forge/bench/` de temporales/duplicados, no de evidencia.

Defectos viejos: baseline artificial de dos llamadas con `--ignore-user-config`/`--skip-git-repo-check`; escenarios demasiado pequeños; tokens sin ponderar output/caché; N=1.

### Escenarios

| caso | afirmación y resultado esperado |
|---|---|
| A | Dos tareas de un fichero: Forge ≈ `solo` en coste/calidad, nunca peor. |
| B | Feature multi-fichero que no cabe en contexto: aislamiento; Forge más barato, calidad igual. |
| C | Trabajo mecánico masivo: puerta determinista; ≈0 tokens en bucle y coste cercano a script manual. |
| D | Bug en repo desconocido: exploración; Forge más barato, calidad igual. |
| E | Bug sutil inyectado: reviewer lo detecta, corrige y deja checks verdes. |
| F | Mismo objetivo, prompt pobre/preciso: enriquecer sin inventar; preciso evita llamada; mismo objetivo. |
| G | Transitorio, interrupción y cambio externo: recuperar, no pisar, nunca falso éxito. |
| H | Reviewer con error/JSON inválido/timeout/repetición: anfitrión resuelve, sin bucle ni fallo final propio. |

A protege lo simple; B-F prueban capacidades; G-H no romper anfitrión. Ningún escenario sabotea `solo`.

### Brazos, aislamiento y métricas

- `solo`: anfitrión real, un comando, config/skills/CLAUDE.md reales; sólo Forge desactivado.
- `forge`: `/forge <tarea>`.
- `script`: sólo C, suelo teórico, no competidor.
- Ablaciones internas: sin herramientas, Graphify, Headroom y ambas.
- Ejecutar por separado en Claude Code y Codex; mismo commit, repo limpio/aislado, modelo, esfuerzo, tier, versión, config y skills congelados; orden aleatorio; ningún hook Forge en `solo`.
- Medir input, cache-read, output, llamadas, coste equivalente con tarifa real, ratio de caché, finalización (`completed:false` = fallo), tiempo y calidad ciega con aceptación visible.
- Desarrollo: 3 runs. Sustitución: ≥5 por escenario estocástico, mediana, rango y causas; diferencias dentro de dispersión no cuentan.

### Puertas por escenario

| caso | puerta |
|---|---|
| A | coste ≤1,1x `solo`; cero derrotas del juez |
| B | coste ≤0,7x; calidad ≥`solo` |
| C | tokens de modelo ≤0,2x y completa; registrar `solo` sin presuponer fallo |
| D | coste ≤0,8x; calidad ≥`solo` |
| E | detecta y corrige bug; tests y review final verdes aunque `solo` también pueda |
| F | cero desviaciones; preciso sin llamada extra; pobre sólo pide aprobación por decisión material |
| G | cero falsos `completed`, cero cambios pisados, recuperar todo fallo declarado recuperable |
| H | cero fallos sólo por reviewer, cero bucles, anfitrión decide mediante evidencia |
| Todos | 100% finalización válida; calidad ≥`solo`; comparar caché/coste sólo con telemetría equivalente |

Transformación Graphify/Headroom que falle usa original y queda registrada; las herramientas permanecen. No compensar una derrota con otro escenario. Si núcleo falla calidad/fiabilidad, v3 no sustituye v2. Si orquestación no aporta frente a `solo`, Forge no existe: entregar sólo catálogo de skills.

Runner pequeño y escenarios como datos; sin framework, plugins ni abstracciones únicas. ~300 líneas orientativas, sin sacrificar aislamiento, telemetría o reproducibilidad. `bench/token-audit.mjs` queda como utilidad independiente.

## 6. Fuera de alcance

- LangGraph: runtime extra sin arreglar DSL ni secuestro del turno.
- Caché propia de llamadas: usar proveedor; sólo cachear derivados baratos —inventario, grafo, lenguaje— con hash de fichero.
- Motor propio de checkpoints, ledger, ownership o parches: usar sesiones, Git, herramientas y estado compacto; mantener garantías mínimas.
- Proceso hijo por fase: sólo fallback CLI sin delegación nativa.

## 7. Ponytail obligatorio

- Antes de escribir en fases 3-7: ¿hace falta? → stdlib → nativo → dependencia instalada → una línea → mínimo código.
- Final de cada fase: `/ponytail-review`; aplicar o justificar cada hallazgo. Final fase 9: `/ponytail-audit`.
- Atajo deliberado: comentario `ponytail:` con techo y mejora; `/ponytail-debt` final debe ser corto.
- Prohibido: interfaz con una implementación, factoría de un producto, config constante, andamiaje futuro.
- Nunca simplificar validación en fronteras, prevención de pérdida, seguridad ni requisitos explícitos.
- Objetivo orientativo: ~800 líneas JS, resto Markdown. Exceso requiere justificar garantía/capacidad; nunca recortar validación, recuperación o tests para cumplir cifra.
