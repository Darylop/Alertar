# AlertAR ⚡

Suscripción mensual (Mercado Pago) para recibir por **Telegram privado** las alertas oficiales del **SMN** que toquen un **radio de 4 km** de la dirección de cada cliente, con un **mapa** de su zona.

Bot de Telegram (@AlertasMeteorologicasArg_bot), con su propio proyecto en Vercel y su propia base de datos.

👉 **Para publicarlo, seguí [INSTRUCCIONES.md](INSTRUCCIONES.md).**

## Qué incluye

| Parte | Dónde |
|---|---|
| Landing inmersiva (responsive, mobile primero) | `public/index.html` |
| Registro, ingreso y recuperación de contraseña | `public/cuenta.html` · `api/cuenta.js` |
| Panel del cliente: dirección en mapa, vinculación de Telegram con QR, suscripción, notificaciones | `public/panel.html` · `api/geo.js`, `api/telegram.js`, `api/pago.js` |
| Panel de administración: clientes, pagos, mapa, alertas, precio, CSV | `public/admin.html` · `api/admin.js` |
| Motor de alertas (cada 10 min) | `api/revisar.js` → `lib/procesar.js` |
| Revisión diaria de pagos y recordatorios | `api/diario.js` → `lib/pagos.js` |

## Cómo funciona el motor

1. Lee el feed CAP del SMN (con caché de los XML ya leídos).
2. Toma solo los clientes que pueden recibir alertas: dirección + Telegram + suscripción al día (o en días de gracia, o con cortesía).
3. Indexa a los clientes por cuadrícula (~10 km) y cruza cada alerta solo con los cercanos: **50.000 clientes se cruzan en menos de 0,1 s**.
4. Calcula la distancia del punto de cada cliente al área (0 si está adentro) y avisa si es ≤ 4 km.
5. **Mapa:** si en una zona de ~25 km hay hasta 15 clientes, cada uno recibe su mapa personal (su punto y su radio). Con más, la zona comparte una imagen que **se sube una sola vez a Telegram y se reenvía por su `file_id`** (sin costo extra por cliente).
6. Envía respetando el límite de Telegram (~25 mensajes por segundo). Si se acaba el tiempo de la función, se vuelve a llamar sola y sigue donde quedó: cada alerta guarda a quién ya se le envió, así nadie la recibe dos veces.
7. Avisa las **actualizaciones** y cuando una alerta **se levanta** (cancelación o ausencia en dos revisiones seguidas).

Los mensajes no incluyen enlaces a archivos CAP. Siempre citan la fuente (SMN, licencia CC BY 4.0).

## Pagos

- Suscripción de Mercado Pago **sin plan asociado** (`/preapproval`), una por cliente, con `external_reference` = id del cliente.
- Las notificaciones de Mercado Pago (`/api/pago?accion=webhook`) se verifican con firma y **siempre se vuelve a consultar el estado a la API**.
- Pago fallido → aviso por **correo, Telegram y en la web** (campana y banner). Sigue recibiendo alertas durante los días de gracia (3 por defecto, configurable) y después se pausan. Se reactivan solas al acreditarse el pago.

## Escala y costos

| Servicio | Plan gratis | Hasta dónde alcanza |
|---|---|---|
| Upstash Redis | 500.000 comandos/mes | Miles de clientes (cada revisión sin alertas usa ~10 comandos) |
| Telegram | Sin costo por mensaje | ~25 mensajes/segundo |
| Gmail SMTP | ~500 correos/día | Sobra para avisos de pago |
| cron-job.org | Gratis | — |
| Vercel | Hobby **no permite uso comercial** → Pro | — |
| Mapas (OpenStreetMap) | Gratis con atribución, uso moderado | Si crece mucho, cambiar `TILE_URL` a un proveedor comercial |

## Probar en la compu

```bash
npm install
npm test        # 12 pruebas: lectura del SMN, geometría, motor completo con Telegram y mapas simulados
npm run dev     # http://localhost:3000 (base de datos local en .datos-locales/)
```

En local, el email de admin es `admin@local.test` (registrate con ese email para entrar a `/admin`).
