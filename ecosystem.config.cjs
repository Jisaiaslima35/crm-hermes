module.exports = {
  apps: [
    {
      name: 'crm-hermes',
      cwd: '/root/apps/crm-hermes',
      script: '/usr/bin/python3',
      args: '-m uvicorn webhook_server:app --host 0.0.0.0 --port 3010 --log-level info',
      interpreter: 'none',
      env: {
        PYTHONPATH: '/home/claudeuser/.local/lib/python3.12/site-packages',
        PORT: '3010'
      },
      autorestart: true,
      max_restarts: 15,
      restart_delay: 2000
    },
    {
      name: 'crm-frontend',
      cwd: '/root/apps/crm-hermes',
      script: 'static-server.mjs',
      interpreter: 'node',
      env: {
        PORT: '3007'
      },
      autorestart: true,
      max_restarts: 15,
      restart_delay: 2000
    },
    {
      name: 'crm-followup-worker',
      cwd: '/root/apps/crm-hermes',
      script: '/usr/bin/python3',
      args: 'followup_worker.py',
      interpreter: 'none',
      env: {
        PYTHONPATH: '/home/claudeuser/.local/lib/python3.12/site-packages'
      },
      autorestart: true,
      max_restarts: 15,
      restart_delay: 5000
    },
    {
      name: 'crm-automations-worker',
      cwd: '/root/apps/crm-hermes',
      script: '/usr/bin/python3',
      args: 'cron_automations.py',
      interpreter: 'none',
      env: {
        PYTHONPATH: '/home/claudeuser/.local/lib/python3.12/site-packages'
      },
      autorestart: true,
      max_restarts: 15,
      restart_delay: 5000
    }
  ]
};
