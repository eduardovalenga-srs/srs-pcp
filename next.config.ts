import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * xlsx (SheetJS) é CJS e usa fs/streams no servidor:
   * mantemos o pacote externo para o build não reescrevê-lo.
   */
  serverExternalPackages: ["xlsx"],

  async redirects() {
    return [
      // Renomeação da tela: endereço antigo continua funcionando (307, não permanente).
      { source: "/producao", destination: "/gestao-entregas", permanent: false },
    ];
  },

  async headers() {
    return [
      {
        // Cabeçalhos de segurança em todas as rotas (auditoria da
        // versão consolidada). CSP fica de fora por ora: exige
        // validação com Turbopack/Supabase/Google Fonts antes.
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
