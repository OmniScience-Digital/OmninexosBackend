import express from 'express';
const router = express.Router();
router.get('/', (req, res) => {
    res.send('Server Reachable');
});
export default router;
