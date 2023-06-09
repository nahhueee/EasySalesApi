import {proveedoresctrl} from '../controllers/proveedores_control';
import {Router} from 'express';
const router : Router  = Router();

router.get('/coinc/:proveedor', proveedoresctrl.ObtenerCoincidencias);
router.post('/total', proveedoresctrl.ObtenerTotalProveedores);
router.post('/', proveedoresctrl.ObtenerProveedores);
router.get('/:proveedor', proveedoresctrl.ObtenerProveedor);

router.post('/agregar', proveedoresctrl.Agregar);
router.put('/modificar', proveedoresctrl.Modificar);
router.post('/eliminar', proveedoresctrl.Eliminar);

// Export the router
export default router;