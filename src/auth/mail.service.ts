import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { createTransport, type Transporter } from 'nodemailer';

const DEFAULT_FROM = '0Fraude <no-responder@zeroscam.local>';

/**
 * Envío de correo por SMTP.
 *
 * El servidor de correo se configura con `SMTP_URL` (por ejemplo
 * `smtp://localhost:1025` para Mailpit en esta misma máquina). No sale a
 * internet: entrega a un servidor de la propia red. Sin `SMTP_URL` no hay a
 * dónde mandar y el código se escribe en la consola del servidor, que es lo
 * que se hacía antes.
 */
@Injectable()
export class MailService {
  private transport: Transporter | undefined;

  /**
   * Manda el código de la verificación en dos pasos.
   *
   * @param to - Correo registrado de la cuenta.
   * @param code - Código de 6 dígitos.
   * @param minutes - Cuántos minutos dura.
   * @throws {@link ServiceUnavailableException} si hay servidor de correo
   * configurado y no aceptó el mensaje: sin código no se puede entrar, y es
   * mejor decirlo que dejar a la persona esperando un correo que no llega.
   */
  async sendCode(to: string, code: string, minutes: number): Promise<void> {
    const transport = this.getTransport();
    if (!transport) {
      console.log('Código de verificación para ' + to + ': ' + code);
      return;
    }
    try {
      await transport.sendMail({
        from: process.env.MAIL_FROM || DEFAULT_FROM,
        to,
        subject: 'Tu código de verificación de 0Fraude',
        text:
          `Tu código de verificación es: ${code}\n\n` +
          `Dura ${minutes} minutos y sirve una sola vez.\n` +
          'Si no intentaste iniciar sesión, cambia tu contraseña.',
        html:
          '<p>Tu código de verificación de <strong>0Fraude</strong> es:</p>' +
          `<p style="font-size:28px;letter-spacing:6px"><strong>${code}</strong></p>` +
          `<p>Dura ${minutes} minutos y sirve una sola vez.</p>` +
          '<p>Si no intentaste iniciar sesión, cambia tu contraseña.</p>',
      });
    } catch (err) {
      // Ni el código ni el destinatario van al log: solo por qué falló.
      console.error(
        'No se pudo enviar el correo de verificación: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      throw new ServiceUnavailableException(
        'No se pudo enviar el código de verificación. Intenta más tarde.',
      );
    }
  }

  /** El transporte SMTP, creado la primera vez que hace falta. */
  private getTransport(): Transporter | undefined {
    if (this.transport) return this.transport;
    // Igual que DatabaseModule: la configuración vive en .env.
    if (!process.env.SMTP_URL && existsSync('.env')) process.loadEnvFile();
    const url = process.env.SMTP_URL;
    if (!url) return undefined;
    this.transport = createTransport(url);
    return this.transport;
  }
}
