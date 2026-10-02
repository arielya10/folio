module.exports = {
  apps: [{
    name: 'folio',
    script: './server.js',
    cwd: __dirname,
    node_args: '--env-file=.env',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '256M',
    kill_timeout: 10000,
    time: true,
    env: { NODE_ENV: 'production' },
  }],
};
