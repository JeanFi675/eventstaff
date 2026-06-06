import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import nodemailer from "npm:nodemailer@6.9.7";
import QRCode from "npm:qrcode@1.5.4";
import { Buffer } from "node:buffer";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BASE_URL = "https://jeanfi675.github.io/appel-benevoles/";
const ROLES_NO_MISSIONS_TABLE = new Set([]);
const ROLES_ALWAYS_SEND = new Set(["admin"]);

async function generateQRBuffer(url: string): Promise<Buffer> {
  const dataUrl: string = await QRCode.toDataURL(url, { width: 200, margin: 2 });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64, 'base64');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization Header" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body?.dry_run === true;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier token + rôle admin
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !caller) {
      throw new Error("Utilisateur non authentifié (" + (userError?.message || "Token invalide") + ")");
    }

    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from('benevoles')
      .select('role')
      .eq('user_id', caller.id)
      .single();

    if (profileError || !callerProfile || callerProfile.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: "Accès refusé. Seuls les admins peuvent envoyer le rappel." }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    console.log(`✅ Admin authentifié : ${caller.email} — dry_run=${dryRun}`);

    // Récupérer tous les bénévoles avec un compte auth
    const { data: allBenevoles, error: benevoleError } = await supabaseAdmin
      .from('benevoles')
      .select('id, prenom, nom, email, role, user_id')
      .not('user_id', 'is', null);

    if (benevoleError) throw benevoleError;
    if (!allBenevoles || allBenevoles.length === 0) {
      return new Response(
        JSON.stringify({ message: "Aucun bénévole trouvé." }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Grouper par user_id (un email par compte auth)
    const userGroups = new Map<string, typeof allBenevoles>();
    for (const b of allBenevoles) {
      if (!userGroups.has(b.user_id)) userGroups.set(b.user_id, []);
      userGroups.get(b.user_id)!.push(b);
    }

    // Configuration SMTP
    const transporter = nodemailer.createTransport({
      host: Deno.env.get("SMTP_HOST") || "smtp.gmail.com",
      port: parseInt(Deno.env.get("SMTP_PORT") || "465"),
      secure: true,
      auth: {
        user: Deno.env.get("SMTP_USER"),
        pass: Deno.env.get("SMTP_PASS"),
      },
    });

    let sent = 0;
    let skipped = 0;
    const failed: { email: string; reason: string }[] = [];
    const preview: { email: string; role: string; missions_count: number }[] = [];

    for (const [userId, profiles] of userGroups) {
      const role = profiles[0].role;
      const email = profiles[0].email;
      const profileIds = profiles.map(p => p.id);

      // Récupérer les inscriptions du groupe
      const { data: inscriptions, error: inscError } = await supabaseAdmin
        .from('inscriptions')
        .select('*, postes(*, periodes(nom, ordre)), benevoles(id, prenom, nom)')
        .in('benevole_id', profileIds);

      if (inscError) {
        failed.push({ email, reason: inscError.message });
        continue;
      }

      const hasInscriptions = inscriptions && inscriptions.length > 0;

      // Règle d'envoi : bénévoles/référents sans inscription → skip
      if (!ROLES_ALWAYS_SEND.has(role) && !hasInscriptions) {
        skipped++;
        continue;
      }

      if (dryRun) {
        preview.push({ email, role, missions_count: inscriptions?.length ?? 0 });
        continue;
      }

      try {
        // Formatage des missions
        const rows = (inscriptions || []).map(i => {
          const poste = i.postes;
          const benevole = i.benevoles;
          if (!poste || !benevole) return null;
          return {
            periode: poste.periodes?.nom || 'Autre',
            periodeOrdre: poste.periodes?.ordre ?? 999,
            debut: new Date(poste.periode_debut),
            fin: new Date(poste.periode_fin),
            titre: poste.titre,
            benevole: `${benevole.prenom} ${benevole.nom}`,
          };
        }).filter(r => r !== null);

        rows.sort((a, b) => a.debut - b.debut);

        const groups: Record<string, typeof rows> = {};
        const groupOrder: Record<string, number> = {};
        rows.forEach(row => {
          if (!groups[row.periode]) {
            groups[row.periode] = [];
            groupOrder[row.periode] = row.periodeOrdre;
          }
          groups[row.periode].push(row);
        });

        const sortedGroups = Object.entries(groups).sort(
          ([a], [b]) => (groupOrder[a] ?? 999) - (groupOrder[b] ?? 999)
        );

        // Section 1 — Intro (tous les rôles)
        const showMissionsInIntro = hasInscriptions;
        let htmlContent = `
          <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
            <h1 style="text-align: center; border-bottom: 4px solid #000; padding-bottom: 10px;">Votre Planning Bénévole</h1>
            <p>Bonjour,</p>
            <p>
              Merci de faire partie de l'équipe bénévole — votre engagement
              compte vraiment !
            </p>
            <p>
              La compétition approche et nous avons hâte de vous retrouver sur place.
              ${showMissionsInIntro
                ? "Vous trouverez dans ce mail votre planning de missions, vos QR codes, les informations pratiques pour le jour J, ainsi qu'un lien vers la plateforme de covoiturage dédiée à l'événement."
                : "Vous trouverez dans ce mail vos QR codes, les informations pratiques pour le jour J, ainsi qu'un lien vers la plateforme de covoiturage dédiée à l'événement."
              }
            </p>
            ${showMissionsInIntro && !ROLES_NO_MISSIONS_TABLE.has(role) ? '<p>Voici le récapitulatif de vos missions :</p>' : ''}
        `;

        // Section 2 — Tableau missions par période (benevole, referent, admin uniquement)
        if (!ROLES_NO_MISSIONS_TABLE.has(role) && sortedGroups.length > 0) {
          for (const [periode, missions] of sortedGroups) {
            htmlContent += `
              <div style="margin-top: 20px; border: 2px solid #000; padding: 10px; background-color: #f9f9f9;">
                <h2 style="background-color: #000; color: #fff; padding: 5px 10px; margin: -10px -10px 10px -10px; font-size: 18px; text-transform: uppercase;">${periode}</h2>
                <table style="width: 100%; border-collapse: collapse;">
            `;
            missions.forEach(m => {
              const dateStr = m.debut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
              const timeStr = `${m.debut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })} - ${m.fin.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}`;
              htmlContent += `
                <tr style="border-bottom: 1px solid #ddd;">
                  <td style="padding: 8px;">
                    <strong style="display:block; font-size: 16px;">${m.titre}</strong>
                    <span style="font-size: 14px; color: #666;">👤 ${m.benevole}</span>
                  </td>
                  <td style="padding: 8px; text-align: right; vertical-align: top;">
                    <div style="font-weight: bold;">${dateStr}</div>
                    <div>${timeStr}</div>
                  </td>
                </tr>
              `;
            });
            htmlContent += `</table></div>`;
          }
        }

        // Section 3 — QR Codes (tous les rôles)
        const attachments: nodemailer.Attachment[] = [];
        const tshirtUrl = `${BASE_URL}scanner-tshirt.html?id=${userId}`;
        const tshirtBuffer = await generateQRBuffer(tshirtUrl);
        attachments.push({ filename: 'qr-tshirt.png', content: tshirtBuffer, cid: 'qr-tshirt', contentType: 'image/png' });

        const cagnotteUrl = `${BASE_URL}debit.html?id=${userId}`;
        const cagnotteBuffer = await generateQRBuffer(cagnotteUrl);
        attachments.push({ filename: 'qr-cagnotte.png', content: cagnotteBuffer, cid: 'qr-cagnotte', contentType: 'image/png' });

        const tshirtNoms = profiles.map(p => p.prenom).join(', ');

        htmlContent += `
          <div style="margin-top: 30px; border: 2px solid #000; padding: 15px; background-color: #f0f0f0;">
            <h2 style="font-size: 18px; text-transform: uppercase; margin-top: 0; border-bottom: 2px solid #000; padding-bottom: 8px;">📱 Vos QR Codes</h2>
            <p style="font-size: 14px; color: #555; margin-bottom: 20px;">Enregistrez cet email sur votre téléphone et présentez ces codes sur place.</p>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="width: 50%; padding: 10px; text-align: center; vertical-align: top;">
                  <div style="border: 2px solid #000; padding: 10px; background: #fff;">
                    <p style="font-size: 15px; font-weight: bold; margin: 0 0 6px 0;">👕 Vos T-shirts</p>
                    <img src="cid:qr-tshirt" alt="QR T-shirt" width="160" height="160" style="display: block; margin: 0 auto;" />
                    <p style="font-size: 12px; color: #555; margin: 10px 0 0 0;">À présenter au stand T-shirts à votre arrivée. Couvre l'ensemble des bénévoles du compte (${tshirtNoms}).</p>
                  </div>
                </td>
                <td style="width: 50%; padding: 10px; text-align: center; vertical-align: top;">
                  <div style="border: 2px solid #000; padding: 10px; background: #fff;">
                    <p style="font-size: 15px; font-weight: bold; margin: 0 0 6px 0;">🍕 Buvette / Restauration</p>
                    <img src="cid:qr-cagnotte" alt="QR Cagnotte" width="160" height="160" style="display: block; margin: 0 auto;" />
                    <p style="font-size: 12px; color: #555; margin: 10px 0 0 0;">À présenter à la buvette ou à la restauration pour régler vos consommations grâce à votre cagnotte bénévole.</p>
                  </div>
                </td>
              </tr>
            </table>
          </div>
        `;

        // Section 4 — Infos pratiques (tous les rôles)
        htmlContent += `
          <div style="margin-top: 30px; border: 2px solid #000; padding: 15px; background-color: #f9f9f9;">
            <h2 style="font-size: 18px; text-transform: uppercase; margin-top: 0; border-bottom: 2px solid #000; padding-bottom: 8px;">📍 Infos pratiques</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 8px 8px 0; vertical-align: top; width: 30%; font-weight: bold; font-size: 14px;">Lieu</td>
                <td style="padding: 8px; font-size: 14px;">
                  110 rue des Alpes — 74800 Saint-Pierre-en-Faucigny<br>
                  <a href="https://maps.google.com/?q=110+rue+des+Alpes+74800+Saint-Pierre-en-Faucigny" style="color: #000; font-size: 12px;">Voir sur Google Maps →</a>
                </td>
              </tr>
              <tr style="border-top: 1px solid #ddd;">
                <td style="padding: 8px 8px 8px 0; vertical-align: top; font-weight: bold; font-size: 14px;">À votre arrivée</td>
                <td style="padding: 8px; font-size: 14px;">
                  Présentez-vous au QG bénévole <strong>30 min avant votre 1er créneau</strong> pour récupérer votre t-shirt.<br>
                  <span style="color: #c00; font-weight: bold;">Le programme du weekend est dense et ne laisse pas de place aux imprévus — votre ponctualité est précieuse pour toute l'équipe.</span>
                </td>
              </tr>
              <tr style="border-top: 1px solid #ddd;">
                <td style="padding: 8px 8px 8px 0; vertical-align: top; font-weight: bold; font-size: 14px;">Empêchement ?</td>
                <td style="padding: 8px; font-size: 14px;">
                  Si vous ne pouvez finalement pas être présent(e), merci de modifier vos inscriptions directement sur le site et de répondre à ce mail pour nous prévenir.<br>
                  <a href="https://jeanfi675.github.io/appel-benevoles/" style="color: #000; font-size: 12px;">Accéder au site →</a>
                </td>
              </tr>
              <tr style="border-top: 1px solid #ddd;">
                <td style="padding: 8px 8px 8px 0; vertical-align: top; font-weight: bold; font-size: 14px;">Sur le site</td>
                <td style="padding: 8px; font-size: 14px;">
                  N'hésitez pas à revenir sur le site : vous y trouverez le planning général du weekend ainsi que les coordonnées de votre référent pour chacun de vos postes.<br>
                  <a href="https://jeanfi675.github.io/appel-benevoles/" style="color: #000; font-size: 12px;">Accéder au site →</a>
                </td>
              </tr>
            </table>
          </div>

          <div style="margin-top: 20px; border: 2px solid #000; padding: 15px; background-color: #f9f9f9;">
            <h2 style="font-size: 18px; text-transform: uppercase; margin-top: 0; border-bottom: 2px solid #000; padding-bottom: 8px;">🚗 Covoiturage</h2>
            <p style="font-size: 14px; margin: 10px 0;">
              Une plateforme de covoiturage a été mise en place spécialement pour la compétition.
              Que vous ayez une place à proposer ou un trajet à trouver, n'hésitez pas à l'utiliser !
            </p>
            <p style="text-align: center; margin: 15px 0;">
              <a href="https://togetzer.com/france-esc-diff-jeunes-2026"
                 style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
                Accéder à la plateforme de covoiturage →
              </a>
            </p>
          </div>

          <div style="margin-top: 20px; border: 2px solid #000; padding: 15px; background-color: #f9f9f9;">
            <h2 style="font-size: 18px; text-transform: uppercase; margin-top: 0; border-bottom: 2px solid #000; padding-bottom: 8px;">📸 Partagez vos photos !</h2>
            <p style="font-size: 14px; margin: 10px 0;">
              Une plateforme de partage de photos a été mise en place pour la compétition.
              Partagez vos meilleurs clichés du weekend et retrouvez les photos prises par toute l'équipe !
            </p>
            <p style="text-align: center; margin: 15px 0;">
              <a href="https://app.eventpics.net/IjdXsodJUiLc"
                 style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
                Voir et partager les photos →
              </a>
            </p>
          </div>

          <div style="margin-top: 30px; text-align: center; color: #333;">
            <p style="font-size: 16px; font-weight: bold;">Merci pour votre engagement !</p>
            <p style="font-size: 12px; color: #888; margin-top: 16px;">En cas d'empêchement ou de problème important, répondez directement à ce mail.</p>
          </div>
        </div>
        `;

        await transporter.sendMail({
          from: '"Organisation Bénévoles" <' + (Deno.env.get("SMTP_USER") || "noreply@example.com") + '>',
          to: email,
          subject: "📅 Rappel – Votre Planning Bénévole",
          html: htmlContent,
          attachments,
        });

        console.log(`✅ Envoyé à ${email} (rôle: ${role})`);
        sent++;

        // Anti-throttle SMTP
        await new Promise(r => setTimeout(r, 200));

      } catch (err) {
        console.error(`❌ Échec pour ${email}:`, err.message);
        failed.push({ email, reason: err.message });
      }
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({ dry_run: true, preview, skipped }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ sent, skipped, failed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error("Erreur:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
