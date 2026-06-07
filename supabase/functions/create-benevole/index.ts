import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
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

    const token = authHeader.replace('Bearer ', '');

    // Configuration Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error("Configuration serveur incomplète (URL/KEY manquants)");
    }

    // Client avec le token de l'utilisateur pour vérifier l'authentification
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Valider l'utilisateur appelant
    const { data: { user: caller }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !caller) {
      throw new Error("Utilisateur non authentifié");
    }

    // Vérifier que l'appelant est admin
    const { data: callerProfile, error: profileError } = await supabaseClient
      .from('benevoles')
      .select('role')
      .eq('user_id', caller.id)
      .single();

    if (profileError || !callerProfile || callerProfile.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: "Accès refusé. Seuls les admins peuvent créer des bénévoles." }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    // Récupérer les données du nouveau bénévole
    const { email, nom, prenom, telephone } = await req.json();

    if (!email || !nom || !prenom) {
      return new Response(
        JSON.stringify({ error: "Email, nom et prénom sont requis." }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`✅ Admin ${caller.email} crée un bénévole: ${prenom} ${nom} (${email})`);

    // Client admin pour créer l'utilisateur
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier si un utilisateur existe déjà avec cet email
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());

    let userId: string;

    if (existingUser) {
      // Utilisateur existe déjà, on utilise son ID
      userId = existingUser.id;
      console.log(`📧 Utilisateur existant trouvé: ${userId}`);
      
      // Vérifier si un bénévole existe déjà avec cet user_id
      const { data: existingBenevole } = await supabaseAdmin
        .from('benevoles')
        .select('id')
        .eq('user_id', userId)
        .single();
      
      if (existingBenevole) {
        return new Response(
          JSON.stringify({ error: "Un bénévole existe déjà avec cet email." }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
        );
      }
    } else {
      // Créer un nouvel utilisateur avec email_confirm: true
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        email_confirm: true,  // Compte validé immédiatement
        user_metadata: {
          prenom: prenom,
          nom: nom
        }
      });

      if (createError) {
        console.error("Erreur création utilisateur:", createError);
        throw new Error(`Erreur création compte: ${createError.message}`);
      }

      userId = newUser.user.id;
      console.log(`✨ Nouvel utilisateur créé: ${userId}`);
    }

    // Créer le bénévole dans la table avec le user_id du nouveau compte
    const { data: newBenevole, error: insertError } = await supabaseAdmin
      .from('benevoles')
      .insert({
        user_id: userId,
        email: email,
        nom: nom,
        prenom: prenom,
        // La colonne telephone est NOT NULL (contrainte CHECK : 'INCONNU' ou
        // un format téléphone). Le formulaire admin n'envoie pas toujours de
        // téléphone → on retombe sur le sentinelle 'INCONNU' (modifiable ensuite).
        telephone: telephone || 'INCONNU',
        role: 'benevole'
      })
      .select()
      .single();

    if (insertError) {
      console.error("Erreur insertion bénévole:", insertError);
      throw new Error(`Erreur création bénévole: ${insertError.message}`);
    }

    console.log(`✅ Bénévole créé avec succès: ${newBenevole.id}`);

    return new Response(
      JSON.stringify({ success: true, benevole: newBenevole }),
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
