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
};

export default nextConfig;
