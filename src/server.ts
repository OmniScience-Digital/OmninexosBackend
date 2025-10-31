import 'dotenv/config';
import './index';

// Determine server environment we're working on
if (process.env.NODE_ENV === 'development') {
  import('./crons/dev/dev.env');
} else {
  import('./crons/prod/index.prod');
}
