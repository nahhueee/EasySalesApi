import {rubrosctrl} from '../controllers/rubros_control';
import {Router} from 'express';
const router : Router  = Router();

router.get('/coinc/:rubro', rubrosctrl.ObtenerCoincidencias);
router.post('/total', rubrosctrl.ObtenerTotalRubros);
router.post('/', rubrosctrl.ObtenerRubros);
router.get('/:rubro', rubrosctrl.ObtenerRubro);

router.post('/agregar', rubrosctrl.Agregar);
router.put('/modificar', rubrosctrl.Modificar);
router.post('/eliminar', rubrosctrl.Eliminar);

// Export the router
export default router;