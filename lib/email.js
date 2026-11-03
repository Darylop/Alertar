// Correos con Gmail (SMTP + clave de aplicación). Gratis, unos 500 por día.
import nodemailer from 'nodemailer';
import { MARCA } from './config.js';

let transporte;
function crearTransporte() {
  if (transporte !== undefined) return transporte;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  transporte = user && pass
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT || 465),
        secure: Number(process.env.SMTP_PORT || 465) === 465,
        auth: { user, pass: pass.replace(/\s+/g, '') },
      })
    : null;
  return transporte;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function plantilla({ titulo, parrafos, boton }) {
  return `<!doctype html><html><body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0b1220;padding:18px 24px;color:#fff;font-size:20px;font-weight:bold">⚡ ${MARCA}</td></tr>
<tr><td style="padding:24px;color:#1b2333;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;margin:0 0 12px">${esc(titulo)}</h1>
${parrafos.map((p) => `<p style="margin:0 0 12px">${esc(p)}</p>`).join('')}
${boton ? `<p style="margin:20px 0 4px"><a href="${esc(boton.url)}" style="background:#ff8a00;color:#111;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px;display:inline-block">${esc(boton.texto)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;color:#6b7280;font-size:12px;border-top:1px solid #eee">${MARCA} reenvía las alertas oficiales del Servicio Meteorológico Nacional. No es un servicio oficial del SMN.</td></tr>
</table></td></tr></table></body></html>`;
}

/** Envía un correo. Nunca lanza error: devuelve true/false. */
export async function enviarCorreo(para, { asunto, titulo, parrafos, boton }) {
  const t = crearTransporte();
  if (!t) {
    console.warn('Correo no enviado (faltan SMTP_USER y SMTP_PASS):', asunto, '→', para);
    return false;
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || `${MARCA} <${process.env.SMTP_USER}>`,
      to: para,
      subject: asunto,
      text: [titulo, ...parrafos, boton ? `${boton.texto}: ${boton.url}` : ''].join('\n\n'),
      html: plantilla({ titulo, parrafos, boton }),
    });
    return true;
  } catch (e) {
    console.error('No se pudo enviar el correo', e.message);
    return false;
  }
}
