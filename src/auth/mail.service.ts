import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import { createTransport, type Transporter } from 'nodemailer';

const DEFAULT_FROM = '0Fraude <no-responder@zeroscam.local>';

export type CodeKind = 'login' | 'recuperar' | 'cambiar';

const CODE_TEXTS: Record<
  CodeKind,
  { subject: string; intro: string; warning: string }
> = {
  login: {
    subject: 'Tu código de verificación de 0Fraude',
    intro: 'Tu código de verificación es:',
    warning: 'Si no intentaste iniciar sesión, cambia tu contraseña.',
  },
  recuperar: {
    subject: 'Código para recuperar tu contraseña de 0Fraude',
    intro: 'Tu código para poner una contraseña nueva es:',
    warning:
      'Si no pediste recuperar tu contraseña, ignora este correo: tu contraseña no cambia.',
  },
  cambiar: {
    subject: 'Código para cambiar tu contraseña de 0Fraude',
    intro: 'Tu código para confirmar el cambio de contraseña es:',
    warning:
      'Si no estás cambiando tu contraseña, alguien tiene tu sesión abierta: no compartas este código y recupera tu cuenta.',
  },
};

/**
 * Envío de correo por SMTP.
 *
 * El servidor de correo se configura con `SMTP_URL` (por ejemplo
 * `smtp://localhost:1025` para Mailpit en esta misma máquina). No sale a
 * internet: entrega a un servidor de la propia red. Sin `SMTP_URL` no hay a
 * dónde mandar y, solo en desarrollo, el código se escribe en la consola del
 * servidor.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport: Transporter | undefined;

  /**
   * Manda un código de 6 dígitos: el del segundo paso del login (`login`),
   * el de "Olvidé mi contraseña" (`recuperar`) o el de cambiar la contraseña
   * con la sesión abierta (`cambiar`).
   *
   * @param to - Correo registrado de la cuenta.
   * @param code - Código de 6 dígitos.
   * @param minutes - Cuántos minutos dura.
   * @param kind - Para qué es el código; cambia el asunto y el texto.
   * @throws {@link ServiceUnavailableException} si hay servidor de correo
   * configurado y no aceptó el mensaje: sin código no se puede seguir, y es
   * mejor decirlo que dejar a la persona esperando un correo que no llega.
   */
  async sendCode(
    to: string,
    code: string,
    minutes: number,
    kind: CodeKind = 'login',
  ): Promise<void> {
    const text = CODE_TEXTS[kind];
    await this.send(
      to,
      text.subject,
      `${text.intro} ${code}\n\n` +
        `Dura ${minutes} minutos y sirve una sola vez.\n` +
        text.warning,
      `<p>${text.intro}</p>` +
        `<p style="font-size:28px;letter-spacing:6px"><strong>${code}</strong></p>` +
        `<p>Dura ${minutes} minutos y sirve una sola vez.</p>` +
        `<p>${text.warning}</p>`,
      `[desarrollo] Código (${kind}): ${code}`,
      'No se pudo enviar el código de verificación. Intenta más tarde.',
    );
  }

  /**
   * Avisa que la contraseña de la cuenta cambió, para que la persona se dé
   * cuenta si no fue ella. No lleva enlaces: un correo con enlace de
   * "no fui yo" es justo lo que imita el phishing.
   *
   * @param to - Correo registrado de la cuenta.
   * @param when - Momento del cambio.
   * @param how - `cambio` (con sesión) o `recuperacion` (Olvidé mi contraseña).
   */
  async sendPasswordChanged(
    to: string,
    when: Date,
    how: 'cambio' | 'recuperacion',
  ): Promise<void> {
    const fecha = when.toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const via =
      how === 'recuperacion'
        ? 'con un código de "Olvidé mi contraseña"'
        : 'desde la app, con tu sesión abierta';
    const consejo =
      'Si no fuiste tú, recupera tu cuenta desde "¿Olvidaste tu contraseña?" ' +
      'en la app y escribe a ZeroScam@0fraude.com. Cerramos las demás ' +
      'sesiones de tu cuenta.';
    await this.send(
      to,
      'Tu contraseña de 0Fraude cambió',
      `La contraseña de tu cuenta cambió el ${fecha} (hora del centro de México), ${via}.\n\n${consejo}`,
      `<p>La contraseña de tu cuenta de <strong>0Fraude</strong> cambió el ${fecha} (hora del centro de México), ${via}.</p>` +
        `<p>${consejo}</p>`,
      '[desarrollo] Aviso de contraseña cambiada',
      'No se pudo enviar el aviso de contraseña cambiada.',
    );
  }

  /**
   * Manda un correo. Sin `SMTP_URL`, en desarrollo solo escribe `devLog` en
   * la consola; en producción falla.
   */
  private async send(
    to: string,
    subject: string,
    text: string,
    html: string,
    devLog: string,
    failure: string,
  ): Promise<void> {
    const transport = this.getTransport();
    if (!transport) {
      // Sin servidor de correo, el código solo se muestra en desarrollo para
      // poder probar. En producción un código en los logs dejaría entrar a
      // quien los lea, así que se avisa sin él.
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('Falta SMTP_URL: no se pudo enviar un correo');
        throw new ServiceUnavailableException(failure);
      }
      this.logger.warn(devLog);
      return;
    }
    try {
      await transport.sendMail({
        from: process.env.MAIL_FROM || DEFAULT_FROM,
        to,
        subject,
        text,
        html,
      });
    } catch (err) {
      // Ni el código ni el destinatario van al log: solo por qué falló.
      this.logger.error(
        'No se pudo enviar un correo: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      throw new ServiceUnavailableException(failure);
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
