# Cómo poner AlertAR en marcha (paso a paso, a mano)

Tiempo estimado: **1 hora**. No hace falta saber programar.
Todo se hace con las cuentas de **quien factura** (tu esposo): GitHub, Vercel, Mercado Pago y Gmail.

> **Importante:** AlertAR es un proyecto propio: bot, Vercel y base de datos dedicados.

---

## Antes de empezar: qué vas a necesitar

| Cuenta | Para qué | Costo |
|---|---|---|
| Telegram – bot **@AlertasMeteorologicasArg_bot** | Enviar las alertas | Gratis (ya está creado) |
| GitHub (de tu esposo) | Guardar el código | Gratis |
| Vercel (de tu esposo) | Publicar la web | Ver aviso abajo |
| Upstash (se crea desde Vercel) | Base de datos | Gratis |
| Mercado Pago (de tu esposo) | Cobrar la suscripción | Comisión de MP por cobro |
| Gmail (cualquiera, ideal una nueva tipo `alertar.avisos@gmail.com`) | Enviar correos de aviso | Gratis |
| cron-job.org | Revisar el SMN cada 10 minutos | Gratis |

> ⚠️ **Vercel Hobby (gratis) es solo para uso personal y no comercial.** Como AlertAR cobra una suscripción, corresponde el plan **Pro** (unos USD 20 por mes; verificá el precio actual en vercel.com/pricing). Podés armar todo en Hobby para probar y pasar a Pro antes de cobrar a clientes reales.

---

## Paso 1. Preparar el bot en Telegram (5 min)

Abrí el chat con **@BotFather** y mandá estos comandos (eligiendo tu bot cada vez):

1. `/setdescription` → pegá:
   `Te aviso por privado cuando el SMN emite una alerta a menos de 4 km de tu casa, con el mapa del área. Activalo desde la web de AlertAR.`
2. `/setabouttext` → `Alertas oficiales del SMN para tu dirección, con mapa. Suscripción en la web de AlertAR.`
3. `/setuserpic` → subí un logo (por ejemplo, el rayo naranja sobre fondo oscuro).
4. `/setjoingroups` → **Disable** (el bot es solo para chats privados).

Los comandos `/estado`, `/id` y `/ayuda` los configura la web sola en el paso 8.

---

## Paso 2. Subir el código a GitHub (10 min)

1. En la compu, abrí el archivo **`alertar-para-subir.zip`** (está en `Documentos\alertAR`) y descomprimilo. Adentro hay una carpeta `alertar`.
2. Entrá a <https://github.com/new> **con la cuenta de tu esposo**.
   - **Repository name:** `alertar`
   - Elegí **Private**.
   - Pulsá **Create repository**.
3. En la página nueva, hacé clic en **uploading an existing file**.
4. Abrí la carpeta `alertar` descomprimida, **seleccioná todo lo de adentro** (carpetas `api`, `lib`, `public`, `scripts`, `test` y los archivos sueltos) y arrastralo a la página.
5. Abajo, pulsá **Commit changes**.

> Si usás tu propia cuenta de GitHub en el navegador, abrí una **ventana de incógnito** (Ctrl + Shift + N) y entrá ahí con la cuenta de tu esposo. Así tu sesión no se toca.

---

## Paso 3. Crear el proyecto en Vercel (5 min)

1. En la **misma ventana de incógnito**, entrá a <https://vercel.com/signup> o <https://vercel.com/login> con la cuenta de tu esposo (con **Continue with GitHub** queda conectado a su GitHub).
2. Entrá a <https://vercel.com/new>, buscá el repositorio `alertar` y pulsá **Import**.
3. **Framework Preset:** dejá **Other**. No cambies nada más.
4. Pulsá **Deploy**. Va a terminar con la web publicada pero sin configurar (es normal).
5. Anotá la dirección que te da, por ejemplo `https://alertar.vercel.app`. En esta guía la llamamos **TU-SITIO**.

---

## Paso 4. Crear la base de datos (3 min)

1. En el proyecto de Vercel, abrí la pestaña **Storage** → **Create Database**.
2. Elegí **Upstash** → **Upstash for Redis** → plan **Free**. Región: **São Paulo (gru1)**.
3. Conectala al proyecto `alertar` (marcá **Production** y **Preview**). Vercel agrega solo las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN`.

---

## Paso 5. Conseguir las claves (20 min)

### 5.a Dos claves secretas inventadas
Abrí **PowerShell** en Windows y pegá esta línea **dos veces** (una para cada clave):

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})
```

Cada vez te da un texto largo al azar. Uno va a ser `SESSION_SECRET` y el otro `CRON_SECRET`. Guardalos en un lugar seguro.

### 5.b Clave de Gmail (para los correos de aviso)
1. Entrá a <https://myaccount.google.com/security> con el Gmail que va a enviar los correos.
2. Activá la **Verificación en 2 pasos** (si no la tenía).
3. Entrá a <https://myaccount.google.com/apppasswords>, poné de nombre `AlertAR` y pulsá **Crear**.
4. Te muestra una clave de 16 letras: esa es `SMTP_PASS`. El Gmail completo es `SMTP_USER`.

### 5.c Mercado Pago (cuenta de tu esposo)
1. Entrá a <https://www.mercadopago.com.ar/developers/panel/app> y pulsá **Crear aplicación**.
   - Nombre: `AlertAR`. Tipo de solución: **Pagos online**. Producto: **Suscripciones**.
2. Abrí la aplicación → **Credenciales de producción** → copiá el **Access Token** (empieza con `APP_USR-`). Ese es `MP_ACCESS_TOKEN`.
   - Para probar sin cobrar de verdad, podés usar primero las **Credenciales de prueba** (empiezan con `TEST-`) y pagar con un **usuario de prueba** que se crea en la misma sección.
3. En la misma aplicación, entrá a **Webhooks** → **Configurar notificaciones**:
   - **URL de producción:** `https://TU-SITIO/api/pago?accion=webhook`
   - **Eventos:** marcá **Planes y suscripciones** (y, si aparecen por separado, “Suscripciones” y “Pagos de suscripciones”).
   - Guardá y copiá la **clave secreta** que muestra: es `MP_WEBHOOK_SECRET`.

> El cliente tiene que pagar con una cuenta de Mercado Pago cuyo email coincida con el que pone en el paso 3 del panel (la web ya se lo pide y se lo explica).

### 5.d Tu ID de Telegram (para recibir avisos si algo falla)
Opcional. Después del paso 8, escribile `/id` al bot y te responde tu número. Ese es `TELEGRAM_CHAT_ADMIN`.

---

## Paso 6. Cargar las variables en Vercel (5 min)

En Vercel → proyecto `alertar` → **Settings** → **Environment Variables**, agregá una por una:

| Nombre | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | El token que te dio BotFather |
| `TELEGRAM_BOT_USERNAME` | `AlertasMeteorologicasArg_bot` |
| `SESSION_SECRET` | La primera clave del paso 5.a |
| `CRON_SECRET` | La segunda clave del paso 5.a |
| `ADMIN_EMAILS` | Los emails que van a entrar al panel de administración, separados por coma (p. ej. `tuemail@gmail.com,esposo@gmail.com`) |
| `MP_ACCESS_TOKEN` | Del paso 5.c |
| `MP_WEBHOOK_SECRET` | Del paso 5.c |
| `SMTP_USER` | El Gmail del paso 5.b |
| `SMTP_PASS` | La clave de 16 letras del paso 5.b |
| `SMTP_FROM` | `AlertAR <el-gmail@gmail.com>` |
| `TELEGRAM_CHAT_ADMIN` | (opcional, después del paso 8) |

Después: pestaña **Deployments** → menú **⋯** del último → **Redeploy**. Las variables solo se aplican después de volver a desplegar.

---

## Paso 7. Programar la revisión cada 10 minutos (5 min)

1. Creá una cuenta en <https://console.cron-job.org/signup> y confirmá el correo.
2. Pulsá **CREATE CRONJOB**:
   - **Title:** `AlertAR`
   - **URL:** `https://TU-SITIO/api/revisar`
   - **Execution schedule:** **Every 10 minutes**
3. Pestaña **ADVANCED**:
   - **Headers** → **Add**: Key `Authorization`, Value `Bearer ` + tu `CRON_SECRET` (con un espacio después de *Bearer*).
   - **Request method:** `GET`. Dejá el tiempo de espera en 30 segundos.
4. Pulsá **TEST RUN**: tiene que responder **200** con `"ok": true`.
5. Pulsá **CREATE**.

La revisión diaria de pagos (avisos de falta de pago y recordatorios) la programa Vercel sola, todos los días a las 9:00 h.

---

## Paso 8. Primer ingreso y conectar el bot (5 min)

1. Entrá a `https://TU-SITIO/cuenta?modo=registro` y creá tu cuenta **con uno de los emails de `ADMIN_EMAILS`**.
2. Entrá a `https://TU-SITIO/admin` → pestaña **Sistema y alertas** → pulsá **🔗 Conectar / reconectar el bot**.
   - Tiene que aparecer “Webhook ✅”. Desde ese momento el bot responde y vincula cuentas.
3. Revisá en la misma pestaña que todas las variables tengan ✅.

---

## Paso 9. Probar todo (10 min)

1. Desde el celular, entrá a la web y registrate como si fueras un cliente (con otro email).
2. **Paso 1:** buscá tu dirección, mové el pin si hace falta y confirmá.
3. **Paso 2:** tocá **Conectar mi Telegram** → **Abrir Telegram** → **Iniciar**. El panel se actualiza solo y muestra tu ID.
4. Tocá **🧪 Enviarme una alerta de prueba**: te llega un mensaje con el mapa de tu zona.
5. **Paso 3:** para probar sin pagar, desde `/admin` abrí el cliente y pulsá **🎁 Dar cortesía**. Para probar el pago real, usá credenciales de prueba de Mercado Pago (paso 5.c).

---

## Paso 10. Antes de abrir al público

- [ ] **Renovar el token del bot:** como el token quedó escrito en un chat, en @BotFather mandá `/revoke`, elegí el bot, copiá el token nuevo, reemplazalo en `TELEGRAM_BOT_TOKEN` en Vercel, hacé **Redeploy** y volvé a pulsar **Conectar / reconectar el bot** en `/admin`.
- [ ] Completar los datos entre corchetes (nombre, CUIT, domicilio, email de contacto) en `public/terminos.html` y `public/privacidad.html`. Podés editarlos directo en GitHub (abrís el archivo → ícono del lápiz → **Commit changes**) y Vercel se actualiza solo.
- [ ] Pasar el proyecto de Vercel a **Pro** (uso comercial).
- [ ] Cambiar `MP_ACCESS_TOKEN` a las credenciales de **producción** si probaste con las de prueba.
- [ ] Facturación: Mercado Pago cobra pero **no emite facturas**. Quien cobra tiene que facturar según su condición fiscal (por ejemplo, monotributo en ARCA).
- [ ] (Opcional) Dominio propio: Vercel → **Settings** → **Domains**. Después agregá la variable `SITIO_URL` con la dirección nueva y actualizá la URL del webhook en Mercado Pago.

---

## Uso diario

- **Panel admin:** `https://TU-SITIO/admin` → clientes, quién pagó, mapa de clientes, alertas enviadas, exportar a Excel (CSV), cambiar el precio, dar cortesía, suspender, mandar un mensaje por Telegram.
- **Pausar todos los envíos:** variable `BOT_PAUSADO` = `1` y **Redeploy** (o pausá la tarea en cron-job.org).
- **Si algo falla 3 veces seguidas** (SMN o Telegram), el bot te escribe por privado si cargaste `TELEGRAM_CHAT_ADMIN`.

## Si algo no anda

| Síntoma | Qué revisar |
|---|---|
| El QR no vincula | En `/admin` → Sistema, que el webhook tenga ✅. Si no, pulsá **Conectar / reconectar el bot**. |
| No llegan correos | `SMTP_USER` y `SMTP_PASS` (la clave de aplicación, no la contraseña normal de Gmail). |
| El pago queda “pendiente” | El cliente tiene que tocar **Actualizar estado**. Revisá en Mercado Pago → Webhooks que la URL sea la correcta. |
| cron-job.org da 401 | La cabecera `Authorization` tiene que decir `Bearer ` + exactamente el `CRON_SECRET`. |
| Vercel → **Logs** | Muestra el detalle de cada error. |
