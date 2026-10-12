// PM2 sur Exilium : copié vers /opt/wow-carto/ecosystem.config.cjs.
// Les variables (DATABASE_URL…) sont lues dans /opt/wow-carto/.env, jamais versionné.
module.exports = {
  apps: [
    {
      name: "wow-carto",
      cwd: "/opt/wow-carto",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3030",
      node_args: "--env-file=.env",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "400M",
      env: { NODE_ENV: "production" },
    },
  ],
};
