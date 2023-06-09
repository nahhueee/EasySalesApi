import {cargosctrl} from '../controllers/cargos_control';
import {Router} from 'express';
const router : Router  = Router();

router.get('/', cargosctrl.ObtenerCargos);

// Export the router
export default router;