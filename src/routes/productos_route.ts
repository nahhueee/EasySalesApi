import {productosctrl} from '../controllers/productos_control';
import {Router} from 'express';
const router : Router  = Router();

router.get('/coinc/:producto', productosctrl.ObtenerCoincidencias);
router.post('/total', productosctrl.ObtenerTotalProductos);
router.post('/', productosctrl.ObtenerProductos);
router.get('/:producto', productosctrl.ObtenerProducto);

router.post('/agregar', productosctrl.Agregar);
router.put('/modificar', productosctrl.Modificar);
router.post('/eliminar', productosctrl.Eliminar);

// Export the router
export default router;