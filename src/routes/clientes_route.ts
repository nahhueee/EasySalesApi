import {clientesctrl} from '../controllers/clientes_control';
import {Router} from 'express';
const router : Router  = Router();

router.get('/coinc/:cliente', clientesctrl.ObtenerCoincidencias);
router.post('/total', clientesctrl.ObtenerTotalClientes);
router.post('/', clientesctrl.ObtenerClientes);
router.get('/:cliente', clientesctrl.ObtenerCliente);

router.post('/agregar', clientesctrl.Agregar);
router.put('/modificar', clientesctrl.Modificar);
router.post('/eliminar', clientesctrl.Eliminar);

// Export the router
export default router;