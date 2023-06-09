import {usuariosctrl} from '../controllers/usuarios_control';
import {Router} from 'express';
const router : Router  = Router();

router.post('/total', usuariosctrl.ObtenerTotalUsuarios);
router.post('/', usuariosctrl.ObtenerUsuarios);
router.get('/:usuario', usuariosctrl.ObtenerUsuario);

router.post('/agregar', usuariosctrl.Agregar);
router.put('/modificar', usuariosctrl.Modificar);
router.post('/eliminar', usuariosctrl.Eliminar);

router.post('/login', usuariosctrl.Ingresar);

// Export the router
export default router;