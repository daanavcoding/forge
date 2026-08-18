# Forge v5 — conclusión y diseño definitivo

Basado en mediciones reales, no en diseño: v3 (03-08, A-H, N=1) y v4
(04-08, A-E con N=5 corregido + F-J con N=1).

## 1. Qué mató a cada versión (medido)

| pieza | veredicto | evidencia |
|---|---|---|
| Orquestador + subagentes (v3) | **muerta** | 5,81x total; D con 2 subagentes: 31,6x. 7/8 escenarios usaron cero subagentes y aun así perdieron |
| Headroom | **muerta** | ahorró 12-252 tokens frente a 250k-3,3M gastados |
| Reviewer cíclico | **muerta** | E en v3: 7,58x; el bucle multiplica el turno más caro |
| Graphify obligatorio + bloqueo PreToolUse | **muerta** | su propio criterio de salida: en el repo grande (I) el brazo graphify costó 173k unidades frente a 150k de la búsqueda nativa. Menos pasos (23 vs 39) pero contextos más gordos. Se retira |
| Modo tarea larga por sesiones troceadas | **muerta** | J: slices 660k frente a 185k de una sesión (3,6x, 124 pasos vs 28). Cada sesión nueva arranca con caché fría |
| Inyectar cuerpos de ficheros | **muerta** | C: con los ficheros inlineados el modelo dejó de generalizar y emitió un parche desenrollado de 8.936 caracteres donde solo escribió un bucle de 5 líneas |
| Bloque inyectado como culpable del coste | **falsa** | corregido el confounder de plugins, el catálogo vale ~1.250 tokens de prompt. El coste real de v4 es una "tasa de razonamiento" del primer turno: +400 a +2.200 tokens a precio 6x |

## 2. Qué funcionó (medido, N=5, cache-ajustado)

El núcleo de v4 fase 2 (una sesión, prefijo fijo, meta-prompt+plan fundidos
en el turno 1, reviewer de un turno sobre el diff) **gana donde hay
exploración que eliminar** y pierde donde no la hay:

- B 0,65x · E 0,80x · A 0,90x → gana
- D 1,37x → pierde (tarea trivial, no había nada que ahorrar)
- C ~2x → pierde (por los cuerpos inlineados, ya diagnosticado)

Conclusión estructural: **coste ≈ Σ(contexto por paso del modelo)**. Forge
solo puede ganar quitando pasos de exploración; cualquier pieza que añada
pasos o prefijo pierde por aritmética.

## 3. Diseño v5

Forge deja de ser un orquestador. Es un contrato de sesión con tres piezas y
un interruptor:

1. **Routing de contexto determinista.** La activación explícita siempre
   inyecta Forge. El hook selecciona solo skills relevantes y representa el
   repositorio con archivos objetivo, manifiestos y estructura de directorios;
   no usa un corte fijo de bytes o archivos y nunca inyecta cuerpos.
2. **Turno 1 = meta-prompt + plan, validados por el usuario.** Una respuesta
   completa pero concisa cubre alcance, supuestos, archivos o áreas afectadas,
   verificación, aceptación y riesgos.
3. **Verificación por script (0 tokens) + reviewer de un turno sobre el
   diff**, solo tras verde, una o dos reviews; las correcciones continúan
   mientras aporten evidencia nueva y se reporta el estado real.

Se retiran la orquestación automática y el bloqueo `PreToolUse`. Graphify es
preferido pero admite fallback dirigido; los subagentes nativos solo se usan
cuando el trabajo independiente y acotado los justifica. Para tareas largas:
una sesión con checkpoints y reanudación, sin lanzar hosts anidados.

> Documento histórico de diseño y medición. Las referencias a `forge/` describen
> el prototipo previo al Agent Plugin. La implementación vigente está en
> `plugins/forge/`; el catálogo de skills y el runtime se mantienen allí.

## 4. Presupuesto de cuota

- Tarea trivial: **1,0x** (la puerta apaga Forge).
- Tarea con exploración: **0,65-0,9x** medido en v4.
- Peor caso estructural: turno 1 + reviewer + 2 correcciones = solo + 4
  turnos, ~1,2-1,3x, imposible de superar por diseño porque no existe ningún
  camino que lance procesos o sesiones adicionales.

## 5. Deuda de medición honesta

- La **calidad nunca se ha medido**: el juez estuvo apagado en todos los runs
  de v3 y v4. Antes de declarar v5 cerrada: un run A-H con N=5 y juez
  encendido.
- F, G y H solo tienen N=1 (G dio 1,88x en esa muestra única: hay que
  re-medir con la puerta y el fix de C).
- El ruido dominante son los fallos aleatorios de caché de prefijo (0-23.769
  tokens por run, en ambos brazos): mantener `cache-audit` y alternancia de
  brazos en cualquier medición futura.

## 6. Implementación (2026-08-05)

El bloque siguiente registra el prototipo previo al Agent Plugin; no describe
la implementación vigente. La implementación actual está en `plugins/forge/`:

- `forge/hook.mjs` — único hook (`UserPromptSubmit`): puerta de trivialidad,
  selección de skills por manifiesto (`langgraph` en dependencias → skill
  langgraph, `fastapi` → fastapi, …) más la extensión relevante cuando la
  tarea la necesita; hechos del repo (inventario + comando de
  verificación, **nunca cuerpos de ficheros**); inventario por relevancia y
  estructura jerárquica, sin corte arbitrario de bytes o archivos,
  determinista byte a byte.
- `forge/protocol.md` — el único rulebook: turno 1 meta-prompt + plan
  validado por el usuario, ejecución mínima, verificación por script, un
  una o dos reviews sobre el diff tras verde, correcciones basadas en
  evidencia, reporte honesto y ponytail activo.
- `forge/forge.mjs` — lanzador: escribe la config de hooks del repo y lanza
  **una** sesión del host. Codex con `--disable plugins` por defecto
  (configurable con `--plugins`): el catálogo de plugins no entra en el
  prompt. `--exec` = no interactivo con plan auto-aprobado y registrado.
- `forge/selfcheck.mjs` — prueba ejecutable de routing, relevancia y
  determinismo (`npm test`).
- Borrado: `plugins/` entero, el resolver de plugin de `.codex/`, los tests
  de v4. El harness `bench/` sigue apuntando al árbol borrado y hay que
  re-apuntarlo antes de la medición v5 con juez.

## 7. Medición final (2026-08-10, Codex, N=5 pareado, juez ciego Terra)

Resultado: `bench/results/v5-codex-complete-2026-08-10.json`. 30 runs en
vivo, todos con tests en verde y activación correcta; fases (plan → ejecución
→ verificación → una review) verificadas contra transcripción en 15/15 runs
Forge incluidos. Un intento de large falló las fases (review antes de
verificar), quedó excluido y se relanzó: tasa de incumplimiento 1/16.

| escenario | solo (med) | forge (med) | ratio | juez (solo/forge/empate) |
|---|---:|---:|---:|---|
| small (peor caso, sin puerta) | 61.574 | 65.430 | **1,06x** | 0 / 1 / 4 |
| medium | 71.502 | 86.111 | **1,20x** | 0 / 0 / 5 |
| large | 156.989 | 112.161 | **0,71x** | 3 / 2 / 0 |

Criterios de salida: cumplidos. ≤1,3x en tareas cortas (1,06x y 1,20x),
ahorro real donde hay exploración (0,71x), calidad ≥ solo según juez ciego
(3-3-9 global; en small el juez detectó un defecto real del brazo solo).
El coste del juez se contabiliza fuera de los brazos. Pendiente conocido:
los veredictos del juez en large son inconsistentes entre runs (la tarea
admite dos soluciones válidas); ampliar N si se quiere afinar ese punto.

## 8. Lo que no se hará en v5

- Reescribir el agente o llamar a la API directamente (fuera de suscripción).
- Reintroducir cualquier pieza retirada sin una medición N≥5 con juez que la
  sostenga. Lo que no tenga medición detrás, no entra.
