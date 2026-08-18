# Forge v4 — plan de corrección

Sustituye a `forge-v3-plan.md`. v3 está medido y pierde: 8 escenarios de 8,
5,81x de coste y 3,3x de latencia frente a no usar Forge.

## 1. Diagnóstico medido

| hecho | evidencia |
|---|---|
| Forge pierde en los 8 escenarios | 33,8 → 196,3 créditos |
| El coste está en el input, no en la salida | input 6,2x / output 3,0x |
| La caché se lee bien en ambos brazos | cache_read ≈ 95-97% del input |
| Los subagentes no explican el grueso | 7 de 8 escenarios usaron **cero** y aun así perdieron 1,5x-7,6x |
| Headroom no ahorra nada | 12-252 tokens frente a 250k-3,3M gastados |
| La puerta determinista no dispara | C: 2,48x donde el objetivo era ≤0,2x |

**Ley de coste:** `coste ≈ Σ (contexto en cada paso del modelo)`. Sólo hay dos
palancas: menos pasos, y transcript más delgado. Todo el plan sale de ahí.

### Dos cosas que el diagnóstico de v3 hizo mal

- **La calidad nunca se midió.** El juez estuvo apagado en todos los runs. Todo
  lo anterior es coste sin beneficio al lado, así que ninguna conclusión sobre
  si Forge "merece la pena" es válida todavía.
- **Graphify se midió con la métrica equivocada.** La telemetría cuenta bytes
  y ficheros evitados. El valor de un grafo son *turnos* evitados. El benchmark
  del repositorio local de benchmarks del usuario muestra graphify a 34.604
  tokens contra 58.636 y 61.396 de codegraph y codebase-memory en el proyecto
  grande, y empate a tres en pequeño y mediano.

## 2. Objetivos que se conservan

1. Meta-prompting **por LLM**, validado por el usuario.
2. Planner, para que el código salga ajustado a lo pedido.
3. Skills por lenguaje, descubiertas, con ponytail incorporado.
4. Reviewer **por LLM**, ligero, además de los tests.
5. Graphify como fuente de contexto, **condicionado al tamaño del repo**.
6. No alterar cómo trabaja Codex/Claude Code.

## 3. Objetivos que se retiran

- "Ahorra tokens" en tareas cortas. El brazo solo hace lo mínimo; es
  aritméticamente inalcanzable. Se sustituye por: **≤1,3x a cambio de plan y
  verde verificado**, y ahorro real sólo en tareas largas.
- Headroom.
- Subagentes especializados como camino por defecto.
- El *gauntlet* de once puertas de `auto`.

## 4. Fases

### Fase 0 — Medir antes de reconstruir

Nada de esto cuesta cuota y todo puede invalidar el resto del plan.

- **Test de determinismo de caché.** Generar el bloque inyectado dos veces y
  comparar SHA-256. Si difiere entre turnos (timestamps, run-ids, listados
  variables), cada turno es escritura en frío a 1,25x en vez de lectura a 0,1x
  — doce veces el precio. Encaja con input 6,2x y output 3,0x.
- **Contar los pasos del modelo** por brazo como métrica de primera clase.
  Ahora se infieren de los tokens; hay que medirlos.
- **Encender el juez.** Sin el lado del beneficio no se puede decidir nada.

Si el test de caché sale rojo, arreglarlo antes de seguir: puede llevarse una
parte grande del 5,81x sin tocar el diseño.

### Fase 1 — Borrar

Mayor ganancia por línea eliminada.

- Headroom, entero.
- `validate-plan` (llamada al modelo para revisar su propio plan).
- `prepare` como llamada separada; su contenido pasa a la inyección del hook.
- Subagentes salvo uno: el explorador "lee mucho, devuelve poco".
- El gauntlet de once puertas; queda la verificación propia del proyecto.
- El texto del README sobre modelos fijos y rechazo de flags: ya no está en el
  código.

### Fase 2 — Una sesión, pasos deterministas

Las fases dejan de ser agentes. Pasan a ser texto inyectado una vez y scripts
locales con cero tokens de modelo.

| pieza | coste | cómo |
|---|---|---|
| skills + ponytail | 0 | casadas por extensión y manifiesto, van en el prefijo |
| meta-prompt + planner | **1 turno** | turno 1 de la sesión, fundidos en una respuesta |
| tests | 0 | el comando de verificación del proyecto |
| reviewer | **1 turno** | sobre el diff, después de verde |
| correcciones | 0-2 turnos | sólo si el reviewer o los tests señalan algo |

**Presupuesto: solo + 2 a 4 turnos.** Ahí está el ~1,2-1,3x.

#### Meta-prompt por LLM, validado

Es una llamada al modelo, no una plantilla. Ocurre en el **turno 1**, que es el
más barato de toda la sesión: el transcript está vacío y sólo hay ~3k de
prefijo inyectado. En la misma respuesta reformula la tarea y propone el plan,
y el usuario aprueba ambos de una vez.

En sesión interactiva la aprobación es natural. En modo no interactivo
(`codex exec`, benchmarks) se auto-aprueba y se registra que no hubo humano.

#### Reviewer por LLM, ligero

Un turno, **sobre el diff, nunca sobre el repo**, y sólo después de que los
tests estén en verde. El diff ya está en contexto porque lo acaba de escribir
la sesión, así que no añade lectura nueva.

Contrasta el diff con la especificación aprobada en el turno 1: ¿hace lo que se
pidió, está bien escrito, sobra algo? Devuelve o bien verde, o bien una lista
corta y concreta.

Tres reglas que lo mantienen barato:

1. **Un turno, sin bucle.** Es el turno más caro de la sesión porque llega con
   el contexto ya gordo; uno se paga, un bucle no. v3 lo hacía cíclico y ahí
   está el 8,6x de E.
2. **No bloquea.** Si los tests están verdes, sus observaciones son
   correcciones, no un veto.
3. **Máximo 2 turnos de corrección.** Si sigue insatisfecho, se reporta al
   usuario en vez de seguir gastando.

Reglas de caché, obligatorias:

1. Un proceso, una sesión. Cada proceso nuevo es una escritura en frío.
2. El bloque inyectado va en posición 0 y es **byte a byte idéntico** entre
   turnos.
3. Nada volátil en el prefijo. Ni timestamps, ni run-ids, ni listados que
   cambien.
4. Tope duro del bloque: ~3k tokens. Hechos, no volcados de ficheros.

Regla de transcript: **la salida de cualquier herramienta vive en la
conversación para siempre y se re-envía en cada turno posterior**. Todo lo que
entre se recorta antes de entrar.

El bucle de corrección se acota a 2 intentos. Si sigue rojo, se reporta; no se
sigue quemando cuota.

### Fase 3 — Graphify obligatorio para búsquedas

- La respuesta se recorta antes de entrar en el transcript: rutas y aristas, no
  cuerpos de ficheros.
- Se mantiene `--code-only --no-cluster` y la consulta al `graph.json` local.
- Se descartan codegraph y codebase-memory: peores en los datos propios y sin
  garantía de localidad verificada.

#### La capa de bloqueo (restricción real, no recomendación)

Hoy Forge sólo engancha `UserPromptSubmit`. La restricción necesita un hook
**`PreToolUse`**, que sí puede **denegar** la llamada antes de que se ejecute.
Eso es un bloqueo de verdad; una frase en el prompt no lo es.

**Qué se bloquea:** herramientas de *búsqueda*, y sólo esas.

| Se deniega | Se permite siempre |
|---|---|
| `Grep`, `Glob` | `Read` de una ruta concreta |
| `Bash` con `rg`, `grep`, `find`, `ag`, `ack`, `fd`, `Select-String` | edición, tests, git, build |

Bloquear `Read` rompería el trabajo normal: una vez que el grafo ha dicho qué
ficheros importan, hay que poder abrirlos.

**El mensaje de denegación lleva el comando exacto** a ejecutar en su lugar. Un
"no puedes" a secas cuesta un turno y deja al agente adivinando; un "usa
`<comando>`" cuesta un turno y resuelve.

**Tres condiciones sin las cuales esto no se despliega:**

1. **Fail-open si Graphify no está disponible** — no instalado, repo sin
   indexar, consulta caída. Un bloqueo duro sin salida deja al agente sin forma
   de explorar, y eso es exactamente el fallo original de Forge: no implementa,
   da error, no termina. La restricción se aplica cuando hay grafo; si no lo
   hay, se deja pasar y **se registra**.
2. **El bloqueo es la red, no el mecanismo.** Si el grafo ya viene en el bloque
   inyectado, el agente no llega a pedir `grep` y el hook nunca dispara. Cada
   denegación es un turno perdido, así que un contador alto de denegaciones
   significa que la inyección está mal hecha, no que el bloqueo funcione.
3. **Escotilla explícita** por variable de entorno, registrada en telemetría.
   Sin ella no se puede depurar el propio hook.

**Métricas nuevas, obligatorias:** número de denegaciones y número de
fail-opens por ejecución. Si el fail-open es frecuente, la restricción es
ficción y hay que decirlo en vez de asumir que se está aplicando.

**Codex:** hay que verificar antes si su sistema de hooks admite un
`PreToolUse` con capacidad de denegar. Si no lo admite, en Codex esto no es una
restricción real y no se puede presentar como tal — quedaría en regla de prompt
hasta que exista el mecanismo.

### Fase 4 — Benchmarks que midan lo correcto

- Añadir el número de pasos del modelo como métrica.
- Juez encendido: la calidad es el lado que falta.
- **Escenario nuevo: repo grande, grafo contra búsqueda nativa.** No existe en
  ninguno de los dos benchmarks; es el que zanja si graphify aporta.
- **Escenario nuevo: tarea larga donde la sesión sola se ahoga.** Es el único
  sitio donde Forge puede ser más barato que no usarlo.
- 5 ejecuciones para los escenarios estocásticos. Ahora todos menos C reportan
  `insufficient-runs`.

### Fase 5 — Modo tarea larga (sólo si la fase 4 lo justifica)

Orquestador determinista **por encima de la CLI**, no contra la API: se llama
a `codex exec` / `claude -p` N veces controlando qué ve cada llamada. Mantiene
la facturación por suscripción y no reescribe el agente.

Compromiso: cada llamada arranca con caché fría. Aproximadamente
`0,05·c·N²` (una sesión larga) frente a `N·P` (N sesiones cortas); el cruce
cae en el orden de decenas de pasos. Hay que medirlo, no asumirlo.

El traspaso entre sesiones es acotado y explícito: plan con lo hecho marcado,
ficheros tocados, último error de verificación. Nada más.

## 5. Criterios de salida

| escenario | criterio |
|---|---|
| tarea corta | ≤1,3x coste, ≤1,3x latencia, calidad ≥ solo según el juez |
| repo grande | el brazo con graphify gana al de búsqueda nativa, o graphify se retira |
| bloqueo | denegaciones por ejecución cercanas a cero y fail-opens registrados; si el fail-open es habitual, la restricción no existe |
| tarea larga | Forge por debajo de solo en coste |

Si un criterio no se cumple tras la fase correspondiente, la pieza se retira.
No se conserva nada por diseño, sólo por medición.

## 6. Lo que no se va a hacer

- Reescribir el agente (bucle de herramientas, aplicación de ediciones). Fue el
  fallo original de v2.
- Orquestador contra la API directamente: factura fuera de la suscripción.
- Reintroducir headroom o subagentes obligatorios sin una medición que los
  justifique.

## 7. Ponytail

Obligatorio en todas las fases. Cada pieza que sobreviva lleva un comentario
`ponytail:` que diga por qué existe y qué medición la sostiene. Lo que no tenga
medición detrás, se borra.
