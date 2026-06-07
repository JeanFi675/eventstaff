import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import nodemailer from "npm:nodemailer@6.9.7";
import QRCode from "npm:qrcode@1.5.4";
import { Buffer } from "node:buffer";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    if (authHeader) {
        console.log("Auth Header received:", authHeader.substring(0, 20) + "...");
    } else {
        console.error("Missing Authorization Header");
    }

    if (!authHeader) {
        return new Response(
            JSON.stringify({ error: "Missing Authorization Header" }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        );
    }

    // Parse body pour récupérer baseUrl
    let baseUrl = '';
    try {
        const body = await req.json();
        baseUrl = (body?.baseUrl || '').replace(/\/$/, '') + '/';
    } catch (_) { /* body absent */ }

    const token = authHeader.replace('Bearer ', '');

    // 1. Authentification Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseKey) {
        console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
        throw new Error("Configuration serveur incomplète (URL/KEY manquants)");
    }

    const supabaseClient = createClient(
      supabaseUrl,
      supabaseKey,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError
    } = await supabaseClient.auth.getUser(token);

    if (userError) {
        console.error("Auth getUser error:", userError);
    }

    if (!user) {
        console.error("Invalid Token, user not found via getUser(token)");
        throw new Error("Utilisateur non authentifié (" + (userError?.message || "Token invalide") + ")");
    }

    console.log("✅ User authenticated:", user.email);

    // 2. Configuration SMTP
    // secure=true uniquement sur le port 465 (TLS implicite). Sur le port 587
    // (STARTTLS) ou tout autre port, secure DOIT être false, sinon la connexion
    // TLS échoue immédiatement. On dérive donc secure du port.
    const smtpPort = parseInt(Deno.env.get("SMTP_PORT") || "465");
    const transporter = nodemailer.createTransport({
      host: Deno.env.get("SMTP_HOST") || "smtp.gmail.com",
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: Deno.env.get("SMTP_USER"),
        pass: Deno.env.get("SMTP_PASS"),
      },
    });

    // 3. Récupération des profils de l'utilisateur
    const { data: profiles, error: profError } = await supabaseClient
        .from('benevoles')
        .select('id, prenom, nom')
        .eq('user_id', user.id);

    if (profError) throw profError;
    if (!profiles || profiles.length === 0) {
         return new Response(
            JSON.stringify({ message: "Aucun profil bénévole trouvé pour ce compte." }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
    }

    const profileIds = profiles.map(p => p.id);

    // 3bis. Configuration de l'évènement (identité générique + flags QR)
    //   - event_title / event_address : identité paramétrable (Admin → Configuration)
    //   - cagnotte_active / tshirt_question_active : pilotent l'envoi des QR codes
    const { data: configRows, error: configError } = await supabaseClient
        .from('config')
        .select('key, value')
        .in('key', ['event_title', 'event_address', 'cagnotte_active', 'tshirt_question_active']);

    if (configError) throw configError;

    const cfg: Record<string, unknown> = {};
    (configRows || []).forEach(r => { cfg[r.key] = r.value; });

    const eventTitle = (typeof cfg.event_title === 'string' ? cfg.event_title : '').trim();
    const eventAddress = (typeof cfg.event_address === 'string' ? cfg.event_address : '').trim();
    const tshirtQrActive = cfg.tshirt_question_active === true;
    const cagnotteQrActive = cfg.cagnotte_active === true;

    // Libellé d'évènement générique (repli si non renseigné)
    const eventLabel = eventTitle || 'l\'évènement';

    // 4. Récupération des inscriptions avec jointures (type_postes pour le titre)
    const { data: inscriptions, error: inscError } = await supabaseClient
      .from('inscriptions')
      .select('*, postes(*, type_postes(titre), periodes(nom, ordre)), benevoles(id, prenom, nom)')
      .in('benevole_id', profileIds);

    if (inscError) throw inscError;

    if (!inscriptions || inscriptions.length === 0) {
        return new Response(
            JSON.stringify({ message: "Aucune inscription trouvée." }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
    }

    // 5. Formatage des données
    const rows = inscriptions.map(i => {
        const poste = i.postes;
        const benevole = i.benevoles;
        if (!poste || !benevole) return null;

        return {
            periode: poste.periodes?.nom || 'Autre',
            periodeOrdre: poste.periodes?.ordre ?? 999,
            debut: new Date(poste.periode_debut),
            fin: new Date(poste.periode_fin),
            titre: poste.type_postes?.titre || 'Poste',
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

    // 6. Construction du HTML des missions
    //    Les QR codes ne sont inclus que si baseUrl est connu ET que le flag
    //    correspondant est actif dans Admin → Configuration.
    const hasBaseUrl = !!baseUrl && baseUrl !== '/';
    const includeTshirtQr = hasBaseUrl && tshirtQrActive;
    const includeCagnotteQr = hasBaseUrl && cagnotteQrActive;
    const includeAnyQr = includeTshirtQr || includeCagnotteQr;

    const escapeHtml = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
         .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    let htmlContent = `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h1 style="text-align: center; border-bottom: 4px solid #000; padding-bottom: 10px;">Votre Planning Bénévole</h1>
        <p>Bonjour,</p>
        <p>
          Merci de faire partie de l'équipe bénévole de <strong>${escapeHtml(eventLabel)}</strong>
          — votre engagement compte vraiment !
        </p>
        <p>
          L'évènement approche et nous avons hâte de vous retrouver sur place.
          Vous trouverez dans ce mail votre planning de missions${includeAnyQr ? ', vos QR codes' : ''}
          ainsi que les informations pratiques pour le jour J.
        </p>
        <p>Voici le récapitulatif de vos missions :</p>
    `;

    for (const [periode, missions] of sortedGroups) {
        htmlContent += `
            <div style="margin-top: 20px; border: 2px solid #000; padding: 10px; background-color: #f9f9f9;">
                <h2 style="background-color: #000; color: #fff; padding: 5px 10px; margin: -10px -10px 10px -10px; font-size: 18px; text-transform: uppercase;">${periode}</h2>
                <table style="width: 100%; border-collapse: collapse;">
        `;

        missions.forEach(m => {
            const dateStr = m.debut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
            const timeStr = `${m.debut.toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit', timeZone: 'Europe/Paris'})} - ${m.fin.toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit', timeZone: 'Europe/Paris'})}`;

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

        htmlContent += `
                </table>
            </div>
        `;
    }

    // 7. Section QR Codes et génération des pièces jointes inline
    //    Chaque QR n'est généré et affiché que si son flag est actif
    //    (tshirt_question_active / cagnotte_active dans la table config).
    const attachments: nodemailer.Attachment[] = [];

    if (includeTshirtQr) {
        // QR T-shirt — un par compte (couvre tous les bénévoles du compte)
        const tshirtUrl = `${baseUrl}scanner-tshirt.html?id=${user.id}`;
        const tshirtBuffer = await generateQRBuffer(tshirtUrl);
        attachments.push({
            filename: 'qr-tshirt.png',
            content: tshirtBuffer,
            cid: 'qr-tshirt',
            contentType: 'image/png',
        });
    }

    if (includeCagnotteQr) {
        // QR Cagnotte — un par compte, même ID que le frontend (user.id)
        const cagnotteUrl = `${baseUrl}debit.html?id=${user.id}`;
        const cagnotteBuffer = await generateQRBuffer(cagnotteUrl);
        attachments.push({
            filename: 'qr-cagnotte.png',
            content: cagnotteBuffer,
            cid: 'qr-cagnotte',
            contentType: 'image/png',
        });
    }

    if (includeAnyQr) {
        const tshirtNoms = profiles.map(p => p.prenom).join(', ');

        const tshirtCard = includeTshirtQr ? `
                        <td style="width: 50%; padding: 10px; text-align: center; vertical-align: top;">
                            <div style="border: 2px solid #000; padding: 10px; background: #fff;">
                                <p style="font-size: 15px; font-weight: bold; margin: 0 0 6px 0;">👕 Vos T-shirts</p>
                                <img src="cid:qr-tshirt" alt="QR T-shirt" width="160" height="160" style="display: block; margin: 0 auto;" />
                                <p style="font-size: 12px; color: #555; margin: 10px 0 0 0;">À présenter au stand T-shirts à votre arrivée. Couvre l'ensemble des bénévoles du compte (${escapeHtml(tshirtNoms)}).</p>
                            </div>
                        </td>
        ` : '';

        const cagnotteCard = includeCagnotteQr ? `
                        <td style="width: 50%; padding: 10px; text-align: center; vertical-align: top;">
                            <div style="border: 2px solid #000; padding: 10px; background: #fff;">
                                <p style="font-size: 15px; font-weight: bold; margin: 0 0 6px 0;">🍕 Buvette / Restauration</p>
                                <img src="cid:qr-cagnotte" alt="QR Cagnotte" width="160" height="160" style="display: block; margin: 0 auto;" />
                                <p style="font-size: 12px; color: #555; margin: 10px 0 0 0;">À présenter à la buvette ou à la restauration pour régler vos consommations grâce à votre cagnotte bénévole.</p>
                            </div>
                        </td>
        ` : '';

        htmlContent += `
            <div style="margin-top: 30px; border: 2px solid #000; padding: 15px; background-color: #f0f0f0;">
                <h2 style="font-size: 18px; text-transform: uppercase; margin-top: 0; border-bottom: 2px solid #000; padding-bottom: 8px;">📱 Vos QR Codes</h2>
                <p style="font-size: 14px; color: #555; margin-bottom: 20px;">Enregistrez cet email sur votre téléphone et présentez ces codes sur place.</p>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>${tshirtCard}${cagnotteCard}</tr>
                </table>
            </div>
        `;
    }

    // 8. Infos pratiques
    //    Lieu = config.event_address ; liens site = baseUrl (dynamique).
    const siteUrl = hasBaseUrl ? baseUrl : '';
    const lieuRow = eventAddress ? `
            <tr>
              <td style="padding: 8px 8px 8px 0; vertical-align: top; width: 30%; font-weight: bold; font-size: 14px;">Lieu</td>
              <td style="padding: 8px; font-size: 14px;">
                ${escapeHtml(eventAddress)}<br>
                <a href="https://maps.google.com/?q=${encodeURIComponent(eventAddress)}" style="color: #000; font-size: 12px;">Voir sur Google Maps →</a>
              </td>
            </tr>
    ` : '';

    const siteLink = (label: string) => siteUrl
        ? `<br><a href="${escapeHtml(siteUrl)}" style="color: #000; font-size: 12px;">${label} →</a>`
        : '';

    htmlContent += `
        <div style="margin-top: 30px; border: 2px solid #000; padding: 15px; background-color: #f9f9f9;">
          <h2 style="font-size: 18px; text-transform: uppercase; margin-top: 0; border-bottom: 2px solid #000; padding-bottom: 8px;">📍 Infos pratiques</h2>
          <table style="width: 100%; border-collapse: collapse;">
            ${lieuRow}
            <tr style="border-top: 1px solid #ddd;">
              <td style="padding: 8px 8px 8px 0; vertical-align: top; width: 30%; font-weight: bold; font-size: 14px;">À votre arrivée</td>
              <td style="padding: 8px; font-size: 14px;">
                Présentez-vous au QG bénévole <strong>30 min avant votre 1er créneau</strong> : l'équipe d'accueil vous orientera vers votre poste.<br>
                <span style="color: #c00; font-weight: bold;">Le programme est dense et laisse peu de place aux imprévus — votre ponctualité est précieuse pour toute l'équipe.</span>
              </td>
            </tr>
            <tr style="border-top: 1px solid #ddd;">
              <td style="padding: 8px 8px 8px 0; vertical-align: top; font-weight: bold; font-size: 14px;">Empêchement ?</td>
              <td style="padding: 8px; font-size: 14px;">
                Si vous ne pouvez finalement pas être présent(e), merci de modifier vos inscriptions directement sur le site et de répondre à ce mail pour nous prévenir.${siteLink('Accéder au site')}
              </td>
            </tr>
            <tr style="border-top: 1px solid #ddd;">
              <td style="padding: 8px 8px 8px 0; vertical-align: top; font-weight: bold; font-size: 14px;">Sur le site</td>
              <td style="padding: 8px; font-size: 14px;">
                N'hésitez pas à revenir sur le site : vous y trouverez le planning général ainsi que les coordonnées de votre référent pour chacun de vos postes — pour savoir exactement qui rejoindre dès votre arrivée.${siteLink('Accéder au site')}
              </td>
            </tr>
          </table>
        </div>

        <div style="margin-top: 30px; text-align: center; color: #333;">
            <p style="font-size: 16px; font-weight: bold;">Merci pour votre engagement !</p>
            <p style="font-size: 12px; color: #888; margin-top: 16px;">En cas d'empêchement ou de problème important, répondez directement à ce mail.</p>
        </div>
      </div>
    `;

    // 9. Envoi de l'email
    const info = await transporter.sendMail({
      // Brevo & co exigent une adresse expéditrice VÉRIFIÉE. On la configure via
      // SMTP_FROM ; repli sur SMTP_USER (valable surtout pour Gmail).
      from: '"Organisation Bénévoles" <' + (Deno.env.get("SMTP_FROM") || Deno.env.get("SMTP_USER") || "noreply@example.com") + '>',
      to: user.email,
      subject: "📅 Votre Planning Bénévole",
      html: htmlContent,
      attachments,
    });

    return new Response(
      JSON.stringify({ success: true, messageId: info.messageId }),
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
