import {sucursalesctrl} from '../controllers/sucursales_control';
import {Router} from 'express';
const router : Router  = Router();

router.get('/', sucursalesctrl.ObtenerSucursales);
router.get('/:sucursal', sucursalesctrl.ObtenerSucursal);
router.put('/modificar', sucursalesctrl.Modificar);

// Export the router
export default router;